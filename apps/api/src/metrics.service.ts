import { Injectable } from '@nestjs/common'
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client'
import type { CacheResult, ResourceKey } from '@dcl/contracts'

@Injectable()
export class MetricsService {
  readonly registry = new Registry()
  private readonly requests: Counter<'instance' | 'resource' | 'result'>
  private readonly originReads: Counter<'instance' | 'resource'>
  private readonly cacheErrors: Counter<'instance' | 'operation'>
  private readonly latency: Histogram<'instance' | 'resource' | 'result'>
  private readonly coalesced: Counter<'instance' | 'resource'>

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'dcl_' })
    this.requests = new Counter({
      name: 'dcl_cache_requests_total',
      help: 'Cache read requests by outcome',
      labelNames: ['instance', 'resource', 'result'],
      registers: [this.registry],
    })
    this.originReads = new Counter({
      name: 'dcl_origin_reads_total',
      help: 'Reads that reached PostgreSQL',
      labelNames: ['instance', 'resource'],
      registers: [this.registry],
    })
    this.cacheErrors = new Counter({
      name: 'dcl_cache_errors_total',
      help: 'Redis/cache errors by operation',
      labelNames: ['instance', 'operation'],
      registers: [this.registry],
    })
    this.coalesced = new Counter({
      name: 'dcl_coalesced_requests_total',
      help: 'Requests that waited behind a distributed single-flight lock',
      labelNames: ['instance', 'resource'],
      registers: [this.registry],
    })
    this.latency = new Histogram({
      name: 'dcl_request_duration_seconds',
      help: 'Resource request duration',
      labelNames: ['instance', 'resource', 'result'],
      buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
      registers: [this.registry],
    })
  }

  observeRequest(
    instance: string,
    resource: ResourceKey,
    result: CacheResult,
    latencyMs: number,
  ): void {
    this.requests.inc({ instance, resource, result })
    this.latency.observe({ instance, resource, result }, latencyMs / 1000)
  }

  observeOriginRead(instance: string, resource: ResourceKey): void {
    this.originReads.inc({ instance, resource })
  }

  observeCacheError(instance: string, operation: string): void {
    this.cacheErrors.inc({ instance, operation })
  }

  observeCoalesced(instance: string, resource: ResourceKey): void {
    this.coalesced.inc({ instance, resource })
  }
}
