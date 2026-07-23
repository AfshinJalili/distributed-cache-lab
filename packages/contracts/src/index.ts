export const resourceKeys = [
  'product:42',
  'flags:global',
  'catalog:home',
  'pricing:pro',
  'product:404',
] as const

export type ResourceKey = (typeof resourceKeys)[number]
export type EvictionPolicy = 'LRU' | 'LFU'
export type WritePolicy = 'invalidate' | 'write-through'
export type CacheResult = 'HIT' | 'MISS' | 'STALE' | 'NEGATIVE_HIT' | 'BYPASS'
export type CacheEntryHealth = 'fresh' | 'stale' | 'expired' | 'negative'
export type FaultName = 'redis-outage' | 'slow-origin'

export type CacheSettings = {
  ttlSeconds: number
  staleWindowSeconds: number
  negativeTtlSeconds: number
  capacity: number
  eviction: EvictionPolicy
  coalescing: boolean
  staleWhileRevalidate: boolean
  ttlJitter: boolean
  writePolicy: WritePolicy
}

export type ResourceDocument = {
  name: string
  description: string
  data: Record<string, unknown>
}

export type ResourceView = {
  key: ResourceKey
  version: number
  document: ResourceDocument
  updatedAt: string
}

export type CacheEntryView = {
  key: ResourceKey
  version: number
  health: CacheEntryHealth
  negative: boolean
  createdAt: number
  softExpiresAt: number
  hardExpiresAt: number
  lastAccessedAt: number
  hits: number
  ttlRemainingSeconds: number
  originVersion: number | null
}

export type CacheMetrics = {
  requests: number
  hits: number
  misses: number
  staleServed: number
  negativeHits: number
  bypasses: number
  originReads: number
  originWrites: number
  evictions: number
  coalesced: number
  lockTimeouts: number
  cacheErrors: number
  totalLatencyMs: number
}

export type InstanceHealth = {
  id: string
  role: 'api' | 'worker'
  lastSeenAt: number
}

export type LabEventKind =
  | 'hit'
  | 'miss'
  | 'stale'
  | 'negative'
  | 'origin'
  | 'write'
  | 'evict'
  | 'coalesce'
  | 'fault'
  | 'system'

export type LabEvent = {
  id: string
  at: number
  kind: LabEventKind
  title: string
  detail: string
  instanceId?: string
  traceId?: string
  resourceKey?: ResourceKey
}

export type RequestTrace = {
  id: string
  key: ResourceKey
  result: CacheResult
  latencyMs: number
  instanceId: string
  traceId?: string
  hops: string[]
  note: string
}

export type LabState = {
  now: number
  settings: CacheSettings
  entries: CacheEntryView[]
  originVersions: Partial<Record<ResourceKey, number>>
  metrics: CacheMetrics
  instances: InstanceHealth[]
  faults: Record<FaultName, boolean>
  lastTrace: RequestTrace | null
}

export type ResourceResponse = {
  resource: ResourceView | null
  cache: {
    result: CacheResult
    ageSeconds: number
    ttlSeconds: number
    instanceId: string
    traceId?: string
  }
}

export type PatchSettingsRequest = Partial<CacheSettings>

export type WriteResourceResponse = {
  key: ResourceKey
  version: number
  reconciliation: 'pending'
  writePolicy: WritePolicy
  outboxEventId: string
}
