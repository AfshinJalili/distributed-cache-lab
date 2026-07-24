import { Inject, Injectable } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { Queue } from 'bullmq'
import { DataSource, Repository } from 'typeorm'
import type {
  CacheSettings,
  FaultName,
  LabState,
} from '@dcl/contracts'
import {
  CacheStore,
  EventBus,
  LabStateStore,
  ResourceEntity,
  defaultSettings,
  resetSeedData,
  toResourceView,
} from '@dcl/platform'
import { PatchSettingsDto } from './dto'
import { ResourcesService } from './resources.service'
import { ToxiproxyService } from './toxiproxy.service'
import { CACHE_STORE, EVENT_BUS, LAB_STATE, REFRESH_QUEUE } from './tokens'

const faultEvents: Record<
  FaultName,
  {
    title: string
    enabledDetail: string
    disabledDetail: string
    emitBeforeEnable: boolean
  }
> = {
  'redis-outage': {
    title: 'REDIS OUTAGE',
    enabledDetail: 'Toxiproxy will cut cache responses; circuit breakers should open',
    disabledDetail: 'Redis connectivity restored; circuit breakers will recover',
    emitBeforeEnable: true,
  },
  'slow-origin': {
    title: 'SLOW ORIGIN',
    enabledDetail: 'PostgreSQL proxy latency increased',
    disabledDetail: 'PostgreSQL proxy latency restored',
    emitBeforeEnable: false,
  },
}

@Injectable()
export class LabService {
  private readonly instanceId = process.env.INSTANCE_ID ?? `api-${process.pid}`

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ResourceEntity)
    private readonly resourceRepository: Repository<ResourceEntity>,
    @Inject(LAB_STATE) private readonly labState: LabStateStore,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(REFRESH_QUEUE) private readonly refreshQueue: Queue,
    private readonly resources: ResourcesService,
    private readonly toxiproxy: ToxiproxyService,
  ) {}

  async state(): Promise<LabState> {
    const [originVersions, faults] = await Promise.all([
      this.resources.versions(),
      this.toxiproxy.getFaults(),
    ])
    try {
      const [now, settings, metrics, instances, lastTrace] = await Promise.all([
        this.labState.now(),
        this.labState.getSettings(),
        this.labState.getMetrics(),
        this.labState.getInstances(),
        this.labState.getLastTrace(),
      ])
      const entries = await this.cache.list(now, originVersions)
      return {
        now,
        settings,
        entries,
        originVersions,
        metrics,
        instances,
        faults,
        lastTrace,
      }
    } catch {
      return {
        now: Date.now(),
        settings: defaultSettings,
        entries: [],
        originVersions,
        metrics: {
          requests: 0,
          hits: 0,
          misses: 0,
          staleServed: 0,
          negativeHits: 0,
          bypasses: 0,
          originReads: 0,
          originWrites: 0,
          evictions: 0,
          coalesced: 0,
          lockTimeouts: 0,
          cacheErrors: 0,
          totalLatencyMs: 0,
        },
        instances: [],
        faults,
        lastTrace: null,
      }
    }
  }

  async patchSettings(patch: PatchSettingsDto): Promise<CacheSettings> {
    const before = await this.labState.getSettings()
    const settings = await this.labState.patchSettings(patch)
    if (patch.capacity !== undefined && patch.capacity < before.capacity) {
      await this.cache.trim(settings.capacity, settings.eviction)
    }
    await this.events.emit({
      at: await this.labState.now(),
      kind: 'system',
      title: 'CACHE POLICY UPDATED',
      detail: Object.entries(patch)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' · '),
      instanceId: this.instanceId,
    })
    return settings
  }

  async advanceClock(seconds: number): Promise<{ now: number }> {
    const now = await this.labState.advanceClock(seconds)
    await this.events.emit({
      at: now,
      kind: 'system',
      title: `CLOCK +${seconds}s`,
      detail: 'Shared logical clock advanced across both API replicas',
      instanceId: this.instanceId,
    })
    return { now }
  }

  async flush(): Promise<void> {
    await this.cache.flush()
    await this.events.emit({
      at: await this.labState.now(),
      kind: 'system',
      title: 'CACHE FLUSHED',
      detail: 'All bounded cache entries removed',
      instanceId: this.instanceId,
    })
  }

  async reset(): Promise<LabState> {
    await this.dataSource.transaction((manager) => resetSeedData(manager))
    await this.refreshQueue.drain(true)
    await this.labState.reset()

    const settings = await this.labState.getSettings()
    const now = await this.labState.now()
    const resources = await this.resourceRepository.findBy([
      { key: 'product:42' },
      { key: 'flags:global' },
      { key: 'catalog:home' },
    ])
    for (const resource of resources) {
      await this.cache.put(resource.key, toResourceView(resource), settings, now)
    }
    await this.events.emit({
      at: now,
      kind: 'system',
      title: 'LAB RESET',
      detail: 'Origin reseeded · three keys warmed · metrics cleared',
      instanceId: this.instanceId,
    })
    return this.state()
  }

  async setFault(name: FaultName, enabled: boolean): Promise<void> {
    const definition = faultEvents[name]
    const emit = async () =>
      this.events.emit({
        at: await this.labState.now(),
        kind: 'fault',
        title: `${definition.title} ${enabled ? 'ENABLED' : 'CLEARED'}`,
        detail: enabled ? definition.enabledDetail : definition.disabledDetail,
        instanceId: this.instanceId,
      })

    if (enabled && definition.emitBeforeEnable) await emit()
    await this.toxiproxy.setFault(name, enabled)
    if (!enabled || !definition.emitBeforeEnable) await emit().catch(() => undefined)
  }
}
