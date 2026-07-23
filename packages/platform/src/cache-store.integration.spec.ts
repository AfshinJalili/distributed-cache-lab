import type Redis from 'ioredis'
import type { CacheSettings, ResourceView } from '@dcl/contracts'
import { CacheStore } from './cache-store'
import { createRedis } from './redis'

const integration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip

const settings: CacheSettings = {
  ttlSeconds: 30,
  staleWindowSeconds: 30,
  negativeTtlSeconds: 5,
  capacity: 2,
  eviction: 'LRU',
  coalescing: true,
  staleWhileRevalidate: false,
  ttlJitter: false,
  writePolicy: 'invalidate',
}

function resource(key: ResourceView['key'], version: number): ResourceView {
  return {
    key,
    version,
    updatedAt: new Date(0).toISOString(),
    document: { name: key, description: 'integration fixture', data: {} },
  }
}

integration('CacheStore with Redis', () => {
  let redis: Redis
  let store: CacheStore

  beforeAll(async () => {
    redis = createRedis({
      host: process.env.TEST_REDIS_HOST ?? 'localhost',
      port: Number(process.env.TEST_REDIS_PORT ?? 6379),
    })
    await redis.connect()
    store = new CacheStore(redis)
  })

  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('evicts the least recently used entry at exact capacity', async () => {
    await store.put('product:42', resource('product:42', 12), settings, 1000)
    await store.put('flags:global', resource('flags:global', 8), settings, 2000)
    const first = await store.get('product:42', 2500)
    expect(first).not.toBeNull()
    await store.touch(first!, 3000)

    const result = await store.put('catalog:home', resource('catalog:home', 21), settings, 4000)

    expect(result.evictedKey).toBe('flags:global')
    expect(await store.get('product:42', 4000)).not.toBeNull()
    expect(await store.get('flags:global', 4000)).toBeNull()
  })

  it('stores a separately bounded negative-cache sentinel', async () => {
    const { record } = await store.put('product:404', null, settings, 1000)
    expect(record.negative).toBe(true)
    expect(record.softExpiresAt).toBe(6000)
    expect((await store.get('product:404', 5999))?.negative).toBe(true)
    expect(await store.get('product:404', 6001)).toBeNull()
  })

  it('trims an existing pool when capacity is reduced', async () => {
    const roomy = { ...settings, capacity: 4 }
    await store.put('product:42', resource('product:42', 12), roomy, 1000)
    await store.put('flags:global', resource('flags:global', 8), roomy, 2000)
    await store.put('catalog:home', resource('catalog:home', 21), roomy, 3000)

    const victims = await store.trim(2, 'LRU')
    expect(victims).toEqual(['product:42'])
    expect((await store.list(3500, {})).map((entry) => entry.key)).toEqual([
      'flags:global',
      'catalog:home',
    ])
  })
})
