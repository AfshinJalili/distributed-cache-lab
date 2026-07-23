import { performance } from 'node:perf_hooks'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Queue } from 'bullmq'
import { Repository } from 'typeorm'
import type {
  CacheMetrics,
  CacheResult,
  CacheSettings,
  RequestTrace,
  ResourceKey,
  ResourceResponse,
  ResourceView,
} from '@dcl/contracts'
import {
  CacheStore,
  CircuitBreaker,
  DistributedLock,
  EventBus,
  LabStateStore,
  ResourceEntity,
} from '@dcl/platform'
import { MetricsService } from './metrics.service'
import {
  CACHE_STORE,
  DISTRIBUTED_LOCK,
  EVENT_BUS,
  LAB_STATE,
  REFRESH_QUEUE,
} from './tokens'

export type ReadOutcome = {
  response: ResourceResponse
  trace: RequestTrace
  statusCode: 200 | 404
}

function toView(entity: ResourceEntity): ResourceView {
  return {
    key: entity.key,
    version: entity.version,
    document: entity.document,
    updatedAt: entity.updatedAt.toISOString(),
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

@Injectable()
export class ResourceCacheService {
  private readonly logger = new Logger(ResourceCacheService.name, { timestamp: true })
  private readonly instanceId = process.env.INSTANCE_ID ?? `api-${process.pid}`
  private readonly breaker = new CircuitBreaker(2, 3000)
  private readonly originDelayMs = Number(process.env.ORIGIN_DELAY_MS ?? 40)

  constructor(
    @InjectRepository(ResourceEntity)
    private readonly resources: Repository<ResourceEntity>,
    @Inject(LAB_STATE) private readonly labState: LabStateStore,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(DISTRIBUTED_LOCK) private readonly locks: DistributedLock,
    @Inject(REFRESH_QUEUE) private readonly refreshQueue: Queue,
    private readonly metrics: MetricsService,
  ) {}

  async read(key: ResourceKey): Promise<ReadOutcome> {
    const startedAt = performance.now()
    let now: number
    let settings: CacheSettings

    try {
      ;[now, settings] = await this.breaker.execute(() =>
        Promise.all([this.labState.now(), this.labState.getSettings()]),
      )
    } catch {
      return this.readBypass(key, startedAt, 'Redis unavailable; cache circuit open')
    }

    let record
    try {
      record = await this.breaker.execute(() => this.cache.get(key, now))
    } catch (error) {
      this.metrics.observeCacheError(this.instanceId, 'get')
      await this.safeMetrics({ cacheErrors: 1 })
      this.logger.warn({ event: 'cache_error', operation: 'get', key, error: String(error) })
      return this.readBypass(key, startedAt, 'Redis unavailable; request bypassed the cache')
    }

    if (record && record.softExpiresAt > now) {
      const touched = await this.breaker.execute(() => this.cache.touch(record, now))
      return this.finish({
        key,
        startedAt,
        now,
        result: touched.negative ? 'NEGATIVE_HIT' : 'HIT',
        resource: touched.resource,
        ageSeconds: Math.floor((now - touched.createdAt) / 1000),
        ttlSeconds: Math.max(0, Math.ceil((touched.softExpiresAt - now) / 1000)),
        hops: ['client', `${this.instanceId} · cache lookup`, 'Redis · fresh entry'],
        note: touched.negative
          ? 'A short-lived not-found sentinel protected PostgreSQL.'
          : 'Fresh Redis data returned without an origin read.',
        sharedMetrics: touched.negative
          ? { requests: 1, hits: 1, negativeHits: 1 }
          : { requests: 1, hits: 1 },
        eventKind: touched.negative ? 'negative' : 'hit',
      })
    }

    if (record && settings.staleWhileRevalidate) {
      await this.enqueueRefresh(key)
      return this.finish({
        key,
        startedAt,
        now,
        result: 'STALE',
        resource: record.resource,
        ageSeconds: Math.floor((now - record.createdAt) / 1000),
        ttlSeconds: 0,
        hops: [
          'client',
          `${this.instanceId} · cache lookup`,
          'Redis · soft TTL crossed',
          'BullMQ · refresh deduplicated',
        ],
        note: 'Bounded stale data returned while a durable refresh runs asynchronously.',
        sharedMetrics: { requests: 1, hits: 1, staleServed: 1 },
        eventKind: 'stale',
      })
    }

    await this.safeMetrics({ requests: 1, misses: 1 })

    if (!settings.coalescing) {
      return this.fetchAndFill(key, settings, now, startedAt, false)
    }

    let lease
    try {
      lease = await this.breaker.execute(() => this.locks.acquire(key))
    } catch {
      return this.readBypass(key, startedAt, 'Redis lock unavailable; request bypassed the cache', {
        countRequest: false,
      })
    }

    if (lease) {
      try {
        return await this.fetchAndFill(key, settings, now, startedAt, false)
      } finally {
        await this.locks.release(lease).catch(() => undefined)
      }
    }

    this.metrics.observeCoalesced(this.instanceId, key)
    await this.safeMetrics({ coalesced: 1 })
    await this.safeEvent({
      at: now,
      kind: 'coalesce',
      title: `MISS COLLAPSED · ${key}`,
      detail: `${this.instanceId} waiting behind the per-key lock`,
      resourceKey: key,
    })

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(25 + attempt * 2)
      try {
        const filled = await this.cache.get(key, await this.labState.now())
        if (filled && filled.softExpiresAt > now) {
          return this.finish({
            key,
            startedAt,
            now,
            result: 'MISS',
            resource: filled.resource,
            ageSeconds: 0,
            ttlSeconds: Math.ceil((filled.softExpiresAt - now) / 1000),
            hops: [
              'client',
              `${this.instanceId} · cache MISS`,
              'Redis single-flight lock · waiter',
              'Redis · filled by another replica',
            ],
            note: 'This miss was collapsed behind one origin read.',
            sharedMetrics: {},
            eventKind: 'coalesce',
          })
        }
      } catch {
        break
      }
    }

    await this.safeMetrics({ lockTimeouts: 1 })
    return this.fetchAndFill(key, settings, now, startedAt, true)
  }

  private async fetchAndFill(
    key: ResourceKey,
    settings: CacheSettings,
    now: number,
    startedAt: number,
    lockTimedOut: boolean,
  ): Promise<ReadOutcome> {
    const resource = await this.readOrigin(key)
    let evictedKey: ResourceKey | null = null
    try {
      const result = await this.breaker.execute(() => this.cache.put(key, resource, settings, now))
      evictedKey = result.evictedKey
      if (evictedKey) {
        await this.safeMetrics({ evictions: 1 })
        await this.safeEvent({
          at: now,
          kind: 'evict',
          title: `${settings.eviction} EVICTION`,
          detail: `${evictedKey} left the ${settings.capacity}-slot pool`,
          resourceKey: evictedKey,
        })
      }
    } catch (error) {
      this.metrics.observeCacheError(this.instanceId, 'put')
      await this.safeMetrics({ cacheErrors: 1 })
      this.logger.warn({ event: 'cache_error', operation: 'put', key, error: String(error) })
    }

    return this.finish({
      key,
      startedAt,
      now,
      result: 'MISS',
      resource,
      ageSeconds: 0,
      ttlSeconds: resource ? settings.ttlSeconds : settings.negativeTtlSeconds,
      hops: [
        'client',
        `${this.instanceId} · cache MISS`,
        lockTimedOut ? 'single-flight · bounded wait elapsed' : 'single-flight · lock owner',
        'PostgreSQL · origin read',
        resource ? 'Redis · cache fill' : 'Redis · negative fill',
      ],
      note: resource
        ? `Origin data cached${evictedKey ? ` after evicting ${evictedKey}` : ''}.`
        : 'Origin returned no row; a short-lived negative entry was stored.',
      sharedMetrics: {},
      eventKind: 'miss',
    })
  }

  private async readBypass(
    key: ResourceKey,
    startedAt: number,
    note: string,
    options: { countRequest?: boolean } = {},
  ): Promise<ReadOutcome> {
    const resource = await this.readOrigin(key, false)
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt))
    const trace: RequestTrace = {
      id: `${Date.now()}-${this.instanceId}`,
      key,
      result: 'BYPASS',
      latencyMs,
      instanceId: this.instanceId,
      hops: ['client', `${this.instanceId} · circuit breaker`, 'PostgreSQL · direct read'],
      note,
    }
    this.metrics.observeRequest(this.instanceId, key, 'BYPASS', latencyMs)
    await this.safeMetrics({
      requests: options.countRequest === false ? 0 : 1,
      bypasses: 1,
      totalLatencyMs: latencyMs,
    })
    await this.safeTrace(trace)
    return {
      response: {
        resource,
        cache: {
          result: 'BYPASS',
          ageSeconds: 0,
          ttlSeconds: 0,
          instanceId: this.instanceId,
        },
      },
      trace,
      statusCode: resource ? 200 : 404,
    }
  }

  private async readOrigin(key: ResourceKey, sharedMetric = true): Promise<ResourceView | null> {
    if (this.originDelayMs > 0) await wait(this.originDelayMs)
    const entity = await this.resources.findOneBy({ key })
    this.metrics.observeOriginRead(this.instanceId, key)
    if (sharedMetric) await this.safeMetrics({ originReads: 1 })
    await this.safeEvent({
      at: await this.safeNow(),
      kind: 'origin',
      title: `ORIGIN READ · ${key}`,
      detail: `${this.instanceId} queried PostgreSQL`,
      resourceKey: key,
    })
    return entity ? toView(entity) : null
  }

  private async enqueueRefresh(key: ResourceKey): Promise<void> {
    await this.refreshQueue.add(
      'refresh',
      { key },
      {
        deduplication: {
          id: Buffer.from(key).toString('base64url'),
        },
      },
    )
  }

  private async finish(input: {
    key: ResourceKey
    startedAt: number
    now: number
    result: CacheResult
    resource: ResourceView | null
    ageSeconds: number
    ttlSeconds: number
    hops: string[]
    note: string
    sharedMetrics: Partial<CacheMetrics>
    eventKind: 'hit' | 'miss' | 'stale' | 'negative' | 'coalesce'
  }): Promise<ReadOutcome> {
    const latencyMs = Math.max(1, Math.round(performance.now() - input.startedAt))
    const trace: RequestTrace = {
      id: `${Date.now()}-${this.instanceId}`,
      key: input.key,
      result: input.result,
      latencyMs,
      instanceId: this.instanceId,
      hops: input.hops,
      note: input.note,
    }
    this.metrics.observeRequest(this.instanceId, input.key, input.result, latencyMs)
    await this.safeMetrics({ ...input.sharedMetrics, totalLatencyMs: latencyMs })
    await this.safeTrace(trace)
    await this.safeEvent({
      at: input.now,
      kind: input.eventKind,
      title: `${input.result} · ${input.key}`,
      detail: `${latencyMs} ms · served by ${this.instanceId}`,
      resourceKey: input.key,
    })
    this.logger.log({
      event: 'resource_read',
      key: input.key,
      result: input.result,
      latencyMs,
      instanceId: this.instanceId,
    })
    return {
      response: {
        resource: input.resource,
        cache: {
          result: input.result,
          ageSeconds: input.ageSeconds,
          ttlSeconds: input.ttlSeconds,
          instanceId: this.instanceId,
        },
      },
      trace,
      statusCode: input.resource ? 200 : 404,
    }
  }

  private async safeMetrics(changes: Partial<CacheMetrics>): Promise<void> {
    await this.labState.incrementMetrics(changes).catch(() => undefined)
  }

  private async safeTrace(value: RequestTrace): Promise<void> {
    await this.labState.setLastTrace(value).catch(() => undefined)
  }

  private async safeNow(): Promise<number> {
    return this.labState.now().catch(() => Date.now())
  }

  private async safeEvent(
    event: Omit<Parameters<EventBus['emit']>[0], 'instanceId'>,
  ): Promise<void> {
    await this.events.emit({ ...event, instanceId: this.instanceId }).catch(() => undefined)
  }
}
