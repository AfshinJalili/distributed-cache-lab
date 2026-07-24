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
      db: Number(process.env.TEST_REDIS_DB ?? 0),
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
    await store.touch('product:42', 3000)

    const result = await store.put('catalog:home', resource('catalog:home', 21), settings, 4000)

    expect(result.evictedKey).toBe('flags:global')
    expect(await store.get('product:42', 4000)).not.toBeNull()
    expect(await store.get('flags:global', 4000)).toBeNull()
  })

  it('cannot recreate an entry invalidated before a touch', async () => {
    await store.put('product:42', resource('product:42', 12), settings, 1000)
    expect(await store.get('product:42', 1001)).not.toBeNull()

    await store.invalidate('product:42')

    expect(await store.touch('product:42', 1002)).toBeNull()
    expect(await store.get('product:42', 1002)).toBeNull()
  })

  it('keeps the newest resource when an older write arrives later', async () => {
    await store.put('pricing:pro', resource('pricing:pro', 5), settings, 1000)

    const delayed = await store.put('pricing:pro', resource('pricing:pro', 4), settings, 2000)

    expect(delayed.written).toBe(false)
    expect((await store.get('pricing:pro', 2001))?.version).toBe(5)
  })

  it('does not let an older invalidation remove a newer cached version', async () => {
    await store.put('pricing:pro', resource('pricing:pro', 5), settings, 1000)

    expect(await store.invalidateThroughVersion('pricing:pro', 4)).toBe(false)
    expect((await store.get('pricing:pro', 1001))?.version).toBe(5)

    expect(await store.invalidateThroughVersion('pricing:pro', 5)).toBe(true)
    expect(await store.get('pricing:pro', 1001)).toBeNull()
  })

  it('does not let an older write recreate data after a newer invalidation', async () => {
    await store.put('pricing:pro', resource('pricing:pro', 4), settings, 1000)
    await store.invalidateThroughVersion('pricing:pro', 5)

    const delayed = await store.put('pricing:pro', resource('pricing:pro', 4), settings, 2000)

    expect(delayed.written).toBe(false)
    expect(await store.get('pricing:pro', 2001)).toBeNull()
    expect(
      (await store.put('pricing:pro', resource('pricing:pro', 5), settings, 3000)).written,
    ).toBe(true)
  })

  it('clears version fences when the entire cache is flushed', async () => {
    await store.put('pricing:pro', resource('pricing:pro', 5), settings, 1000)
    await store.invalidateThroughVersion('pricing:pro', 5)

    await store.flush()

    const seeded = await store.put('pricing:pro', resource('pricing:pro', 1), settings, 2000)
    expect(seeded.written).toBe(true)
    expect((await store.get('pricing:pro', 2001))?.version).toBe(1)
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

  it('evicts the least frequently used entry after switching policies', async () => {
    await store.put('product:42', resource('product:42', 12), settings, 1000)
    await store.put('flags:global', resource('flags:global', 8), settings, 2000)
    await store.touch('product:42', 3000)
    await store.touch('product:42', 4000)

    const result = await store.put(
      'catalog:home',
      resource('catalog:home', 21),
      { ...settings, eviction: 'LFU' },
      5000,
    )

    expect(result.evictedKey).toBe('flags:global')
    expect(await store.get('product:42', 5000)).not.toBeNull()
    expect(await store.get('flags:global', 5000)).toBeNull()
  })
})
