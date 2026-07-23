import type Redis from 'ioredis'
import {
  type CacheMetrics,
  type CacheSettings,
  type InstanceHealth,
  type RequestTrace,
} from '@dcl/contracts'
import { keys } from './keys'

export const defaultSettings: CacheSettings = {
  ttlSeconds: 30,
  staleWindowSeconds: 45,
  negativeTtlSeconds: 8,
  capacity: 4,
  eviction: 'LRU',
  coalescing: true,
  staleWhileRevalidate: false,
  ttlJitter: true,
  writePolicy: 'invalidate',
}

const metricNames: (keyof CacheMetrics)[] = [
  'requests',
  'hits',
  'misses',
  'staleServed',
  'negativeHits',
  'bypasses',
  'originReads',
  'originWrites',
  'evictions',
  'coalesced',
  'lockTimeouts',
  'cacheErrors',
  'totalLatencyMs',
]

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === 'true'
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export class LabStateStore {
  constructor(private readonly redis: Redis) {}

  async ensureDefaults(): Promise<void> {
    const exists = await this.redis.exists(keys.settings)
    if (exists) return
    await this.setSettings(defaultSettings)
  }

  async getSettings(): Promise<CacheSettings> {
    await this.ensureDefaults()
    const values = await this.redis.hgetall(keys.settings)
    return {
      ttlSeconds: parseNumber(values.ttlSeconds, defaultSettings.ttlSeconds),
      staleWindowSeconds: parseNumber(
        values.staleWindowSeconds,
        defaultSettings.staleWindowSeconds,
      ),
      negativeTtlSeconds: parseNumber(
        values.negativeTtlSeconds,
        defaultSettings.negativeTtlSeconds,
      ),
      capacity: parseNumber(values.capacity, defaultSettings.capacity),
      eviction: values.eviction === 'LFU' ? 'LFU' : 'LRU',
      coalescing: parseBoolean(values.coalescing, defaultSettings.coalescing),
      staleWhileRevalidate: parseBoolean(
        values.staleWhileRevalidate,
        defaultSettings.staleWhileRevalidate,
      ),
      ttlJitter: parseBoolean(values.ttlJitter, defaultSettings.ttlJitter),
      writePolicy: values.writePolicy === 'write-through' ? 'write-through' : 'invalidate',
    }
  }

  async setSettings(settings: CacheSettings): Promise<void> {
    await this.redis.hset(
      keys.settings,
      Object.fromEntries(
        Object.entries(settings).map(([name, value]) => [name, String(value)]),
      ),
    )
  }

  async patchSettings(patch: Partial<CacheSettings>): Promise<CacheSettings> {
    const current = await this.getSettings()
    const next = { ...current, ...patch }
    await this.setSettings(next)
    return next
  }

  async now(): Promise<number> {
    const offset = Number((await this.redis.get(keys.clockOffset)) ?? 0)
    return Date.now() + offset
  }

  async advanceClock(seconds: number): Promise<number> {
    await this.redis.incrby(keys.clockOffset, seconds * 1000)
    return this.now()
  }

  async incrementMetrics(changes: Partial<CacheMetrics>): Promise<void> {
    const transaction = this.redis.multi()
    for (const [name, amount] of Object.entries(changes)) {
      if (amount) transaction.hincrbyfloat(keys.metrics, name, amount)
    }
    await transaction.exec()
  }

  async getMetrics(): Promise<CacheMetrics> {
    const values = await this.redis.hgetall(keys.metrics)
    return Object.fromEntries(
      metricNames.map((name) => [name, parseNumber(values[name], 0)]),
    ) as unknown as CacheMetrics
  }

  async setLastTrace(trace: RequestTrace): Promise<void> {
    await this.redis.set(keys.lastTrace, JSON.stringify(trace))
  }

  async getLastTrace(): Promise<RequestTrace | null> {
    const raw = await this.redis.get(keys.lastTrace)
    return raw ? (JSON.parse(raw) as RequestTrace) : null
  }

  async heartbeat(instance: InstanceHealth): Promise<void> {
    await this.redis.hset(keys.instances, instance.id, JSON.stringify(instance))
  }

  async getInstances(): Promise<InstanceHealth[]> {
    const values = await this.redis.hvals(keys.instances)
    const cutoff = Date.now() - 15_000
    return values
      .map((value) => JSON.parse(value) as InstanceHealth)
      .filter((instance) => instance.lastSeenAt >= cutoff)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  async reset(): Promise<void> {
    const found = await this.redis.scan(0, 'MATCH', `${keys.prefix}*`, 'COUNT', 500)
    if (found[1].length) await this.redis.del(...found[1])
    await this.setSettings(defaultSettings)
    await this.redis.set(keys.clockOffset, '0')
  }
}
