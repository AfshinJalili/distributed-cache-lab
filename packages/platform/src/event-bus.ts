import type Redis from 'ioredis'
import type { LabEvent, LabEventKind, ResourceKey } from '@dcl/contracts'
import { trace } from '@opentelemetry/api'
import { keys } from './keys'

export type EmitEvent = {
  at: number
  kind: LabEventKind
  title: string
  detail: string
  instanceId?: string
  resourceKey?: ResourceKey
  traceId?: string
}

export class EventBus {
  constructor(private readonly redis: Redis) {}

  async emit(input: EmitEvent): Promise<LabEvent> {
    const activeTraceId = trace.getActiveSpan()?.spanContext().traceId
    const event = {
      ...input,
      traceId: input.traceId ?? activeTraceId,
    }
    const id = await this.redis.xadd(
      keys.events,
      'MAXLEN',
      '~',
      250,
      '*',
      'data',
      JSON.stringify(event),
    )
    if (!id) throw new Error('Redis did not return a stream event id')
    return { id, ...event }
  }

  async recent(count = 30): Promise<LabEvent[]> {
    const rows = await this.redis.xrevrange(keys.events, '+', '-', 'COUNT', count)
    return rows.map(([id, fields]) => {
      const dataIndex = fields.indexOf('data')
      const raw = dataIndex >= 0 ? fields[dataIndex + 1] : '{}'
      return { id, ...(JSON.parse(raw ?? '{}') as Omit<LabEvent, 'id'>) }
    })
  }
}
