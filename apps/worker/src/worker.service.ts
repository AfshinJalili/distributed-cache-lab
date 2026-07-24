import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import type Redis from 'ioredis'
import {
  CacheStore,
  EventBus,
  LabStateStore,
  createDataSource,
  createRedis,
} from '@dcl/platform'
import type { DataSource } from 'typeorm'
import { HeartbeatPublisher } from './heartbeat-publisher'
import { OutboxProcessor } from './outbox-processor'
import { RefreshWorker } from './refresh-worker'

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly instanceId = process.env.INSTANCE_ID ?? `worker-${process.pid}`
  private readonly dataSource: DataSource = createDataSource()
  private readonly redis: Redis = createRedis()
  private readonly labState = new LabStateStore(this.redis)
  private readonly cache = new CacheStore(this.redis)
  private readonly events = new EventBus(this.redis)
  private readonly refreshWorker = new RefreshWorker({
    dataSource: this.dataSource,
    labState: this.labState,
    cache: this.cache,
    events: this.events,
    instanceId: this.instanceId,
  })
  private readonly outboxProcessor = new OutboxProcessor({
    dataSource: this.dataSource,
    labState: this.labState,
    cache: this.cache,
    events: this.events,
    instanceId: this.instanceId,
  })
  private readonly heartbeat = new HeartbeatPublisher(this.labState, this.instanceId)

  async onModuleInit(): Promise<void> {
    await this.dataSource.initialize()
    if (this.redis.status === 'wait') await this.redis.connect()
    this.refreshWorker.start()
    await this.heartbeat.start()
    this.outboxProcessor.start()
  }

  async onApplicationShutdown(): Promise<void> {
    this.heartbeat.stop()
    await this.outboxProcessor.stop()
    await this.refreshWorker.stop()
    await Promise.allSettled([this.redis.quit(), this.dataSource.destroy()])
  }
}
