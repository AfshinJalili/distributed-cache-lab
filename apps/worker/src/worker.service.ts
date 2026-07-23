import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import type Redis from 'ioredis'
import type { InstanceHealth, ResourceKey, ResourceView, WritePolicy } from '@dcl/contracts'
import {
  CacheStore,
  EventBus,
  LabStateStore,
  ResourceEntity,
  bullConnectionOptions,
  createDataSource,
  createRedis,
  refreshQueueName,
} from '@dcl/platform'
import type { DataSource } from 'typeorm'

type RefreshJob = {
  key: ResourceKey
}

type ClaimedOutbox = {
  id: string
  resource_key: ResourceKey
  write_policy: WritePolicy
  version: number
  payload: ResourceView
  attempts: number
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name, { timestamp: true })
  private readonly instanceId = process.env.INSTANCE_ID ?? `worker-${process.pid}`
  private readonly dataSource: DataSource = createDataSource()
  private readonly redis: Redis = createRedis()
  private readonly labState = new LabStateStore(this.redis)
  private readonly cache = new CacheStore(this.redis)
  private readonly events = new EventBus(this.redis)
  private worker: Worker<RefreshJob> | undefined
  private stopping = false
  private outboxLoop: Promise<void> | undefined
  private heartbeatTimer: NodeJS.Timeout | undefined

  async onModuleInit(): Promise<void> {
    await this.dataSource.initialize()
    if (this.redis.status === 'wait') await this.redis.connect()
    this.worker = new Worker<RefreshJob>(
      refreshQueueName,
      (job) => this.refresh(job),
      {
        connection: bullConnectionOptions(),
        concurrency: 8,
        lockDuration: 5000,
      },
    )
    this.worker.on('failed', (job, error) => {
      this.logger.error({
        event: 'refresh_failed',
        jobId: job?.id,
        resourceKey: job?.data.key,
        error: error.message,
        instanceId: this.instanceId,
      })
    })
    await this.heartbeat()
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 5000)
    this.heartbeatTimer.unref()
    this.outboxLoop = this.runOutboxLoop()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    await Promise.allSettled([
      this.worker?.close(),
      this.outboxLoop,
      this.redis.quit(),
      this.dataSource.destroy(),
    ])
  }

  private async refresh(job: Job<RefreshJob>): Promise<void> {
    const { key } = job.data
    const settings = await this.labState.getSettings()
    const now = await this.labState.now()
    const entity = await this.dataSource.getRepository(ResourceEntity).findOneBy({ key })
    const resource = entity ? this.toView(entity) : null
    const { evictedKey } = await this.cache.put(key, resource, settings, now)
    await this.labState.incrementMetrics({
      originReads: 1,
      evictions: evictedKey ? 1 : 0,
    })
    await this.events.emit({
      at: now,
      kind: 'origin',
      title: `BACKGROUND REFRESH · ${key}`,
      detail: `${this.instanceId} refreshed ${resource ? `v${resource.version}` : 'negative sentinel'}`,
      instanceId: this.instanceId,
      resourceKey: key,
    })
    this.logger.log({
      event: 'cache_refresh',
      resourceKey: key,
      version: resource?.version ?? 0,
      evictedKey,
      jobId: job.id,
      instanceId: this.instanceId,
    })
  }

  private async runOutboxLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        const event = await this.claimOutbox()
        if (!event) {
          await wait(200)
          continue
        }
        await this.processOutbox(event)
      } catch (error) {
        this.logger.error({
          event: 'outbox_loop_error',
          error: error instanceof Error ? error.message : String(error),
          instanceId: this.instanceId,
        })
        await wait(500)
      }
    }
  }

  private async claimOutbox(): Promise<ClaimedOutbox | null> {
    const result: [ClaimedOutbox[], number] = await this.dataSource.query(`
      WITH candidate AS (
        SELECT id
        FROM cache_outbox
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE cache_outbox AS outbox
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = now()
      FROM candidate
      WHERE outbox.id = candidate.id
      RETURNING outbox.*
    `)
    return result[0][0] ?? null
  }

  private async processOutbox(event: ClaimedOutbox): Promise<void> {
    try {
      const now = await this.labState.now()
      if (event.write_policy === 'invalidate') {
        await this.cache.invalidate(event.resource_key)
      } else {
        await this.cache.put(
          event.resource_key,
          event.payload,
          await this.labState.getSettings(),
          now,
        )
      }
      await this.dataSource.query(
        `UPDATE cache_outbox
         SET status = 'completed', processed_at = now(), updated_at = now(), last_error = NULL
         WHERE id = $1`,
        [event.id],
      )
      await this.events.emit({
        at: now,
        kind: 'write',
        title: `OUTBOX RECONCILED · ${event.resource_key}`,
        detail: `${event.write_policy} applied for v${event.version} by ${this.instanceId}`,
        instanceId: this.instanceId,
        resourceKey: event.resource_key,
      })
      this.logger.log({
        event: 'outbox_reconciled',
        outboxId: event.id,
        resourceKey: event.resource_key,
        writePolicy: event.write_policy,
        version: event.version,
        attempt: event.attempts,
        instanceId: this.instanceId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const retryDelaySeconds = Math.min(30, 2 ** Math.min(event.attempts, 5))
      await this.dataSource.query(
        `UPDATE cache_outbox
         SET status = 'pending',
             next_attempt_at = now() + ($2 * interval '1 second'),
             last_error = $3,
             updated_at = now()
         WHERE id = $1`,
        [event.id, retryDelaySeconds, message],
      )
      throw error
    }
  }

  private async heartbeat(): Promise<void> {
    const instance: InstanceHealth = {
      id: this.instanceId,
      role: 'worker',
      lastSeenAt: Date.now(),
    }
    await this.labState.heartbeat(instance).catch(() => undefined)
  }

  private toView(entity: ResourceEntity): ResourceView {
    return {
      key: entity.key,
      version: entity.version,
      document: entity.document,
      updatedAt: entity.updatedAt.toISOString(),
    }
  }
}
