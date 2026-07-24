import { Logger } from '@nestjs/common'
import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { DataSource } from 'typeorm'
import type { ResourceKey } from '@dcl/contracts'
import {
  ResourceEntity,
  bullConnectionOptions,
  refreshQueueName,
  toResourceView,
} from '@dcl/platform'
import type { CacheStore, EventBus, LabStateStore } from '@dcl/platform'

type RefreshJob = {
  key: ResourceKey
}

export type RefreshWorkerOptions = {
  dataSource: DataSource
  labState: LabStateStore
  cache: CacheStore
  events: EventBus
  instanceId: string
}

export class RefreshWorker {
  private readonly logger = new Logger(RefreshWorker.name, { timestamp: true })
  private worker: Worker<RefreshJob> | undefined

  constructor(private readonly options: RefreshWorkerOptions) {}

  start(): void {
    if (this.worker) return
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
        instanceId: this.options.instanceId,
      })
    })
  }

  async stop(): Promise<void> {
    await this.worker?.close()
    this.worker = undefined
  }

  private async refresh(job: Job<RefreshJob>): Promise<void> {
    const { key } = job.data
    const settings = await this.options.labState.getSettings()
    const now = await this.options.labState.now()
    const entity = await this.options.dataSource.getRepository(ResourceEntity).findOneBy({ key })
    const resource = entity ? toResourceView(entity) : null
    const { evictedKey, written } = await this.options.cache.put(key, resource, settings, now)
    await this.options.labState.incrementMetrics({
      originReads: 1,
      evictions: written && evictedKey ? 1 : 0,
    })
    await this.options.events.emit({
      at: now,
      kind: 'origin',
      title: `BACKGROUND REFRESH · ${key}`,
      detail: written
        ? `${this.options.instanceId} refreshed ${resource ? `v${resource.version}` : 'negative sentinel'}`
        : `${this.options.instanceId} discarded an obsolete refresh`,
      instanceId: this.options.instanceId,
      resourceKey: key,
    })
    this.logger.log({
      event: 'cache_refresh',
      resourceKey: key,
      version: resource?.version ?? 0,
      written,
      evictedKey,
      jobId: job.id,
      instanceId: this.options.instanceId,
    })
  }

}
