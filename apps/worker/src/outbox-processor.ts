import { Logger } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import type { ResourceKey, ResourceView, WritePolicy } from '@dcl/contracts'
import { OutboxEventEntity, delay } from '@dcl/platform'
import type { CacheStore, EventBus, LabStateStore } from '@dcl/platform'

type ClaimedOutbox = {
  id: string
  resource_key: ResourceKey
  write_policy: WritePolicy
  version: number
  payload: ResourceView
  attempts: number
}

export type OutboxProcessorOptions = {
  dataSource: DataSource
  cache: CacheStore
  labState: LabStateStore
  events: EventBus
  instanceId: string
  leaseTimeoutMs?: number
  pollIntervalMs?: number
}

export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name, { timestamp: true })
  private readonly leaseTimeoutMs: number
  private readonly pollIntervalMs: number
  private stopping = false
  private loop: Promise<void> | undefined

  constructor(private readonly options: OutboxProcessorOptions) {
    this.leaseTimeoutMs = options.leaseTimeoutMs ?? 30_000
    this.pollIntervalMs = options.pollIntervalMs ?? 200
  }

  start(): void {
    if (this.loop) return
    this.stopping = false
    this.loop = this.run()
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.loop
    this.loop = undefined
  }

  async processNext(): Promise<boolean> {
    const event = await this.claim()
    if (!event) return false

    try {
      const now = await this.options.labState.now()
      if (event.write_policy === 'invalidate') {
        await this.options.cache.invalidateThroughVersion(event.resource_key, event.version)
      } else {
        await this.options.cache.put(
          event.resource_key,
          event.payload,
          await this.options.labState.getSettings(),
          now,
        )
      }
      await this.complete(event)
      await this.options.events
        .emit({
          at: now,
          kind: 'write',
          title: `OUTBOX RECONCILED · ${event.resource_key}`,
          detail: `${event.write_policy} applied for v${event.version} by ${this.options.instanceId}`,
          instanceId: this.options.instanceId,
          resourceKey: event.resource_key,
        })
        .catch(() => undefined)
      this.logger.log({
        event: 'outbox_reconciled',
        outboxId: event.id,
        resourceKey: event.resource_key,
        writePolicy: event.write_policy,
        version: event.version,
        attempt: event.attempts,
        instanceId: this.options.instanceId,
      })
      return true
    } catch (error) {
      await this.retry(event, error)
      throw error
    }
  }

  private async claim(): Promise<ClaimedOutbox | null> {
    const result: [ClaimedOutbox[], number] = await this.options.dataSource.query(`
      WITH candidate AS (
        SELECT id
        FROM ${this.tableName}
        WHERE
          (status = 'pending' AND next_attempt_at <= now())
          OR
          (status = 'processing' AND updated_at <= now() - ($1 * interval '1 millisecond'))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${this.tableName} AS outbox
      SET status = 'processing',
          attempts = attempts + 1,
          updated_at = now()
      FROM candidate
      WHERE outbox.id = candidate.id
      RETURNING outbox.*
    `, [this.leaseTimeoutMs])
    return result[0][0] ?? null
  }

  private async complete(event: ClaimedOutbox): Promise<void> {
    await this.options.dataSource.query(
      `UPDATE ${this.tableName}
       SET status = 'completed', processed_at = now(), updated_at = now(), last_error = NULL
       WHERE id = $1 AND status = 'processing' AND attempts = $2`,
      [event.id, event.attempts],
    )
  }

  private async retry(event: ClaimedOutbox, error: unknown): Promise<void> {
    const retryDelaySeconds = Math.min(30, 2 ** Math.min(event.attempts, 5))
    const message = error instanceof Error ? error.message : String(error)
    await this.options.dataSource.query(
      `UPDATE ${this.tableName}
       SET status = 'pending',
           next_attempt_at = now() + ($3 * interval '1 second'),
           last_error = $4,
           updated_at = now()
       WHERE id = $1 AND status = 'processing' AND attempts = $2`,
      [event.id, event.attempts, retryDelaySeconds, message],
    )
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      try {
        const processed = await this.processNext()
        if (!processed) await delay(this.pollIntervalMs)
      } catch (error) {
        this.logger.error({
          event: 'outbox_loop_error',
          error: error instanceof Error ? error.message : String(error),
          instanceId: this.options.instanceId,
        })
        await delay(500)
      }
    }
  }

  private get tableName(): string {
    const metadata = this.options.dataSource.getMetadata(OutboxEventEntity)
    return metadata.tablePath
      .split('.')
      .map((part) => this.options.dataSource.driver.escape(part))
      .join('.')
  }
}
