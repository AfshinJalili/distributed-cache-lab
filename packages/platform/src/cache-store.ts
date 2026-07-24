import type Redis from 'ioredis'
import type {
  CacheEntryHealth,
  CacheEntryView,
  CacheSettings,
  ResourceKey,
  ResourceView,
} from '@dcl/contracts'
import { keys } from './keys'

export type CacheRecord = {
  key: ResourceKey
  version: number
  resource: ResourceView | null
  negative: boolean
  createdAt: number
  softExpiresAt: number
  hardExpiresAt: number
  lastAccessedAt: number
  hits: number
}

const PUT_SCRIPT = `
local indexKey = KEYS[1]
local lruKey = KEYS[2]
local lfuKey = KEYS[3]
local member = ARGV[1]
local entryPrefix = ARGV[2]
local payload = ARGV[3]
local ttlMs = tonumber(ARGV[4])
local capacity = tonumber(ARGV[5])
local policy = ARGV[6]
local now = tonumber(ARGV[7])
local incomingVersion = tonumber(ARGV[8])

local current = redis.call('GET', entryPrefix .. member)
local watermark = tonumber(redis.call('HGET', KEYS[4], member) or '-1')
if watermark > incomingVersion then
  return {'', 0, current or payload}
end
if current then
  local currentRecord = cjson.decode(current)
  if tonumber(currentRecord.version) > incomingVersion then
    return {'', 0, current}
  end
end

local members = redis.call('SMEMBERS', indexKey)
for _, current in ipairs(members) do
  if redis.call('EXISTS', entryPrefix .. current) == 0 then
    redis.call('SREM', indexKey, current)
    redis.call('ZREM', lruKey, current)
    redis.call('ZREM', lfuKey, current)
  end
end

local victim = ''
if redis.call('SISMEMBER', indexKey, member) == 0 and redis.call('SCARD', indexKey) >= capacity then
  local policyKey = lruKey
  if policy == 'LFU' then policyKey = lfuKey end
  local candidates = redis.call('ZRANGE', policyKey, 0, 0)
  if #candidates > 0 then
    victim = candidates[1]
    redis.call('DEL', entryPrefix .. victim)
    redis.call('SREM', indexKey, victim)
    redis.call('ZREM', lruKey, victim)
    redis.call('ZREM', lfuKey, victim)
  end
end

redis.call('SET', entryPrefix .. member, payload, 'PX', ttlMs)
redis.call('SADD', indexKey, member)
redis.call('ZADD', lruKey, now, member)
redis.call('ZADD', lfuKey, 0, member)
if incomingVersion > watermark then
  redis.call('HSET', KEYS[4], member, incomingVersion)
end
return {victim, 1, payload}
`

const TOUCH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end

local record = cjson.decode(raw)
record.hits = record.hits + 1
record.lastAccessedAt = tonumber(ARGV[1])

local next = cjson.encode(record)
redis.call('SET', KEYS[1], next, 'KEEPTTL')
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[2])
redis.call('ZINCRBY', KEYS[3], 1, ARGV[2])
return next
`

const INVALIDATE_THROUGH_VERSION_SCRIPT = `
local watermark = tonumber(redis.call('HGET', KEYS[5], ARGV[1]) or '-1')
local invalidatedVersion = tonumber(ARGV[2])
if invalidatedVersion > watermark then
  redis.call('HSET', KEYS[5], ARGV[1], invalidatedVersion)
end

local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end

local record = cjson.decode(raw)
if tonumber(record.version) > invalidatedVersion then return 0 end

redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`

const TRIM_SCRIPT = `
local victims = {}
local indexKey = KEYS[1]
local lruKey = KEYS[2]
local lfuKey = KEYS[3]
local entryPrefix = ARGV[1]
local capacity = tonumber(ARGV[2])
local policyKey = lruKey
if ARGV[3] == 'LFU' then policyKey = lfuKey end

while redis.call('SCARD', indexKey) > capacity do
  local candidates = redis.call('ZRANGE', policyKey, 0, 0)
  if #candidates == 0 then break end
  local victim = candidates[1]
  table.insert(victims, victim)
  redis.call('DEL', entryPrefix .. victim)
  redis.call('SREM', indexKey, victim)
  redis.call('ZREM', lruKey, victim)
  redis.call('ZREM', lfuKey, victim)
end
return cjson.encode(victims)
`

function memberFor(key: ResourceKey): string {
  return Buffer.from(key).toString('base64url')
}

function keyForMember(member: string): string {
  return `${keys.cacheEntryPrefix}${member}`
}

function healthFor(record: CacheRecord, now: number): CacheEntryHealth {
  if (record.negative) return 'negative'
  if (record.hardExpiresAt <= now) return 'expired'
  if (record.softExpiresAt <= now) return 'stale'
  return 'fresh'
}

export class CacheStore {
  constructor(private readonly redis: Redis) {}

  async get(key: ResourceKey, now: number): Promise<CacheRecord | null> {
    const raw = await this.redis.get(keyForMember(memberFor(key)))
    if (!raw) return null
    const record = JSON.parse(raw) as CacheRecord
    if (record.hardExpiresAt <= now) {
      await this.invalidate(key)
      return null
    }
    return record
  }

  async touch(key: ResourceKey, now: number): Promise<CacheRecord | null> {
    const member = memberFor(key)
    const raw = (await this.redis.eval(
      TOUCH_SCRIPT,
      3,
      keyForMember(member),
      keys.cacheLru,
      keys.cacheLfu,
      now,
      member,
    )) as string | null
    return raw ? (JSON.parse(raw) as CacheRecord) : null
  }

  async put(
    key: ResourceKey,
    resource: ResourceView | null,
    settings: CacheSettings,
    now: number,
  ): Promise<{ record: CacheRecord; evictedKey: ResourceKey | null; written: boolean }> {
    const negative = resource === null
    const baseTtlSeconds = negative ? settings.negativeTtlSeconds : settings.ttlSeconds
    const salt = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0)
    const jitter = settings.ttlJitter ? 0.9 + (salt % 5) * 0.05 : 1
    const ttlMs = Math.max(1000, Math.round(baseTtlSeconds * 1000 * jitter))
    const staleWindowMs = negative ? 0 : settings.staleWindowSeconds * 1000
    const record: CacheRecord = {
      key,
      version: resource?.version ?? 0,
      resource,
      negative,
      createdAt: now,
      softExpiresAt: now + ttlMs,
      hardExpiresAt: now + ttlMs + staleWindowMs,
      lastAccessedAt: now,
      hits: 0,
    }
    const member = memberFor(key)
    const [victim, written, stored] = (await this.redis.eval(
      PUT_SCRIPT,
      4,
      keys.cacheIndex,
      keys.cacheLru,
      keys.cacheLfu,
      keys.cacheVersionWatermarks,
      member,
      keys.cacheEntryPrefix,
      JSON.stringify(record),
      ttlMs + staleWindowMs,
      settings.capacity,
      settings.eviction,
      now,
      record.version,
    )) as [string, number, string]

    return {
      record: JSON.parse(stored) as CacheRecord,
      evictedKey: victim
        ? (Buffer.from(victim, 'base64url').toString('utf8') as ResourceKey)
        : null,
      written: written === 1,
    }
  }

  async invalidate(key: ResourceKey): Promise<void> {
    const member = memberFor(key)
    await this.redis
      .multi()
      .del(keyForMember(member))
      .srem(keys.cacheIndex, member)
      .zrem(keys.cacheLru, member)
      .zrem(keys.cacheLfu, member)
      .exec()
  }

  async invalidateThroughVersion(key: ResourceKey, version: number): Promise<boolean> {
    const member = memberFor(key)
    const invalidated = (await this.redis.eval(
      INVALIDATE_THROUGH_VERSION_SCRIPT,
      5,
      keyForMember(member),
      keys.cacheIndex,
      keys.cacheLru,
      keys.cacheLfu,
      keys.cacheVersionWatermarks,
      member,
      version,
    )) as number
    return invalidated === 1
  }

  async flush(): Promise<void> {
    const members = await this.redis.smembers(keys.cacheIndex)
    const transaction = this.redis.multi()
    for (const member of members) transaction.del(keyForMember(member))
    transaction.del(
      keys.cacheIndex,
      keys.cacheLru,
      keys.cacheLfu,
      keys.cacheVersionWatermarks,
    )
    await transaction.exec()
  }

  async trim(capacity: number, policy: 'LRU' | 'LFU'): Promise<ResourceKey[]> {
    const raw = (await this.redis.eval(
      TRIM_SCRIPT,
      3,
      keys.cacheIndex,
      keys.cacheLru,
      keys.cacheLfu,
      keys.cacheEntryPrefix,
      capacity,
      policy,
    )) as string
    return (JSON.parse(raw) as string[]).map(
      (member) => Buffer.from(member, 'base64url').toString('utf8') as ResourceKey,
    )
  }

  async list(
    now: number,
    originVersions: Partial<Record<ResourceKey, number>>,
  ): Promise<CacheEntryView[]> {
    const members = await this.redis.smembers(keys.cacheIndex)
    if (!members.length) return []
    const values = await this.redis.mget(members.map(keyForMember))
    const missing: string[] = []
    const records = values.flatMap((raw, index) => {
      if (!raw) {
        const member = members[index]
        if (member) missing.push(member)
        return []
      }
      return [JSON.parse(raw) as CacheRecord]
    })
    if (missing.length) {
      await this.redis
        .multi()
        .srem(keys.cacheIndex, ...missing)
        .zrem(keys.cacheLru, ...missing)
        .zrem(keys.cacheLfu, ...missing)
        .exec()
    }
    return records
      .map((record) => ({
        key: record.key,
        version: record.version,
        health:
          originVersions[record.key] !== undefined &&
          record.version < (originVersions[record.key] ?? 0)
            ? 'stale'
            : healthFor(record, now),
        negative: record.negative,
        createdAt: record.createdAt,
        softExpiresAt: record.softExpiresAt,
        hardExpiresAt: record.hardExpiresAt,
        lastAccessedAt: record.lastAccessedAt,
        hits: record.hits,
        ttlRemainingSeconds: Math.max(0, Math.ceil((record.softExpiresAt - now) / 1000)),
        originVersion: originVersions[record.key] ?? null,
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }
}
