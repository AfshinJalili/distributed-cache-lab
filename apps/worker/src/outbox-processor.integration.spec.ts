import type Redis from 'ioredis'
import { DataSource } from 'typeorm'
import type { CacheSettings, ResourceView } from '@dcl/contracts'
import {
  CacheStore,
  EventBus,
  LabStateStore,
  OutboxEventEntity,
  createRedis,
} from '@dcl/platform'
import { OutboxProcessor } from './outbox-processor'

const integration =
  process.env.RUN_OUTBOX_INTEGRATION === 'true' ? describe : describe.skip

const settings: CacheSettings = {
  ttlSeconds: 30,
  staleWindowSeconds: 30,
  negativeTtlSeconds: 5,
  capacity: 4,
  eviction: 'LRU',
  coalescing: true,
  staleWhileRevalidate: false,
  ttlJitter: false,
  writePolicy: 'write-through',
}

function pricing(version: number): ResourceView {
  return {
    key: 'pricing:pro',
    version,
    updatedAt: new Date(version * 1000).toISOString(),
    document: {
      name: 'Pro pricing',
      description: 'outbox integration fixture',
      data: { version },
    },
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for outbox reconciliation')
}

integration('OutboxProcessor with PostgreSQL and Redis', () => {
  const schema = `dcl_worker_test_${process.pid}`
  let dataSource: DataSource
  let redis: Redis
  let cache: CacheStore
  let labState: LabStateStore

  beforeAll(async () => {
    const database = {
      type: 'postgres' as const,
      host: process.env.TEST_DB_HOST ?? 'localhost',
      port: Number(process.env.TEST_DB_PORT ?? 5432),
      username: process.env.TEST_DB_USER ?? 'cachelab',
      password: process.env.TEST_DB_PASSWORD ?? 'cachelab',
      database: process.env.TEST_DB_NAME ?? 'cachelab',
    }
    const bootstrap = new DataSource(database)
    await bootstrap.initialize()
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await bootstrap.query(`CREATE SCHEMA "${schema}"`)
    await bootstrap.destroy()

    dataSource = new DataSource({
      ...database,
      schema,
      entities: [OutboxEventEntity],
      synchronize: true,
    })
    await dataSource.initialize()

    redis = createRedis({
      host: process.env.TEST_REDIS_HOST ?? 'localhost',
      port: Number(process.env.TEST_REDIS_PORT ?? 6379),
      db: Number(process.env.TEST_REDIS_DB ?? 14),
    })
    await redis.connect()
    cache = new CacheStore(redis)
    labState = new LabStateStore(redis)
  })

  beforeEach(async () => {
    await redis.flushdb()
    await dataSource.getRepository(OutboxEventEntity).clear()
    await labState.setSettings(settings)
  })

  afterAll(async () => {
    if (redis) {
      await redis.flushdb()
      await redis.quit()
    }
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await dataSource.destroy()
    }
  })

  it('reclaims and completes an event abandoned by a crashed worker', async () => {
    await cache.put('pricing:pro', pricing(4), settings, 1000)
    const repository = dataSource.getRepository(OutboxEventEntity)
    const event = await repository.save(
      repository.create({
        resourceKey: 'pricing:pro',
        writePolicy: 'write-through',
        version: 5,
        payload: pricing(5),
        status: 'processing',
        attempts: 1,
        nextAttemptAt: new Date(0),
      }),
    )
    await repository.update(event.id, { updatedAt: new Date(0) })

    const processor = new OutboxProcessor({
      dataSource,
      cache,
      labState,
      events: new EventBus(redis),
      instanceId: 'worker-test',
      leaseTimeoutMs: 1,
    })

    await expect(processor.processNext()).resolves.toBe(true)
    expect((await cache.get('pricing:pro', 2000))?.version).toBe(5)
    await expect(processor.processNext()).resolves.toBe(false)
  })

  it('runs pending reconciliation until stopped', async () => {
    await cache.put('pricing:pro', pricing(4), settings, 1000)
    const repository = dataSource.getRepository(OutboxEventEntity)
    await repository.save(
      repository.create({
        resourceKey: 'pricing:pro',
        writePolicy: 'write-through',
        version: 5,
        payload: pricing(5),
        status: 'pending',
      }),
    )
    const processor = new OutboxProcessor({
      dataSource,
      cache,
      labState,
      events: new EventBus(redis),
      instanceId: 'worker-test',
      leaseTimeoutMs: 100,
      pollIntervalMs: 5,
    })

    processor.start()
    await waitFor(async () => (await cache.get('pricing:pro', 2000))?.version === 5)
    await processor.stop()

    await expect(processor.processNext()).resolves.toBe(false)
  })
})
