import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm'
import { DataSource, Repository } from 'typeorm'
import type { ResourceKey, WriteResourceResponse } from '@dcl/contracts'
import {
  EventBus,
  LabStateStore,
  OutboxEventEntity,
  ResourceEntity,
  toResourceView,
} from '@dcl/platform'
import { EVENT_BUS, LAB_STATE } from './tokens'

@Injectable()
export class ResourcesService {
  private readonly instanceId = process.env.INSTANCE_ID ?? `api-${process.pid}`

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ResourceEntity)
    private readonly resources: Repository<ResourceEntity>,
    @Inject(LAB_STATE) private readonly labState: LabStateStore,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  async write(key: ResourceKey): Promise<WriteResourceResponse> {
    const writePolicy = (await this.labState.getSettings()).writePolicy
    const result = await this.dataSource.transaction(async (manager) => {
      const resource = await manager.getRepository(ResourceEntity).findOne({
        where: { key },
        lock: { mode: 'pessimistic_write' },
      })
      if (!resource) throw new NotFoundException(`No origin resource exists for ${key}`)

      resource.version += 1
      resource.document = {
        ...resource.document,
        data: {
          ...resource.document.data,
          mutationSequence: resource.version,
          lastMutationAt: new Date().toISOString(),
        },
      }
      const saved = await manager.save(resource)
      const event = manager.create(OutboxEventEntity, {
        resourceKey: key,
        writePolicy,
        version: saved.version,
        payload: toResourceView(saved),
        status: 'pending',
      })
      const savedEvent = await manager.save(event)
      return { resource: saved, outbox: savedEvent }
    })

    await this.labState.incrementMetrics({ originWrites: 1 }).catch(() => undefined)
    await this.events
      .emit({
        at: await this.labState.now().catch(() => Date.now()),
        kind: 'write',
        title: `ORIGIN WRITE · ${key}`,
        detail: `v${result.resource.version} committed with outbox ${result.outbox.id.slice(0, 8)}`,
        instanceId: this.instanceId,
        resourceKey: key,
      })
      .catch(() => undefined)

    return {
      key,
      version: result.resource.version,
      reconciliation: 'pending',
      writePolicy,
      outboxEventId: result.outbox.id,
    }
  }

  async versions(): Promise<Partial<Record<ResourceKey, number>>> {
    const rows = await this.resources.find({ select: { key: true, version: true } })
    return Object.fromEntries(rows.map((row) => [row.key, row.version]))
  }
}
