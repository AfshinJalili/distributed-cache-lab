import { Global, Inject, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'
import type Redis from 'ioredis'
import {
  bullConnectionOptions,
  CacheStore,
  createRedis,
  DistributedLock,
  EventBus,
  LabStateStore,
  refreshQueueName,
} from '@dcl/platform'
import {
  CACHE_STORE,
  DISTRIBUTED_LOCK,
  EVENT_BUS,
  LAB_STATE,
  REDIS,
  REFRESH_QUEUE,
} from './tokens'

class InfrastructureLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REFRESH_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect()
    await this.redis.ping()
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.queue.close(), this.redis.quit()])
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, useFactory: () => createRedis() },
    {
      provide: LAB_STATE,
      useFactory: (redis: Redis) => new LabStateStore(redis),
      inject: [REDIS],
    },
    {
      provide: CACHE_STORE,
      useFactory: (redis: Redis) => new CacheStore(redis),
      inject: [REDIS],
    },
    {
      provide: EVENT_BUS,
      useFactory: (redis: Redis) => new EventBus(redis),
      inject: [REDIS],
    },
    {
      provide: DISTRIBUTED_LOCK,
      useFactory: (redis: Redis) => new DistributedLock(redis),
      inject: [REDIS],
    },
    {
      provide: REFRESH_QUEUE,
      useFactory: () =>
        new Queue(refreshQueueName, {
          connection: bullConnectionOptions(),
          defaultJobOptions: {
            attempts: 4,
            backoff: { type: 'exponential', delay: 250 },
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        }),
    },
    InfrastructureLifecycle,
  ],
  exports: [REDIS, LAB_STATE, CACHE_STORE, EVENT_BUS, DISTRIBUTED_LOCK, REFRESH_QUEUE],
})
export class InfrastructureModule {}
