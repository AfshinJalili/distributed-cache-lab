import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { FaultName } from '@dcl/contracts'

type Toxic = {
  name: string
  type: string
  stream: 'downstream'
  toxicity: number
  attributes: Record<string, number>
}

@Injectable()
export class ToxiproxyService {
  private readonly baseUrl = process.env.TOXIPROXY_URL ?? 'http://localhost:8474'

  async setFault(name: FaultName, enabled: boolean): Promise<void> {
    const configuration =
      name === 'redis-outage'
        ? {
            proxy: 'redis',
            toxic: {
              name: 'cache-cut',
              type: 'timeout',
              stream: 'downstream',
              toxicity: 1,
              attributes: { timeout: 1 },
            } satisfies Toxic,
          }
        : {
            proxy: 'postgres',
            toxic: {
              name: 'origin-latency',
              type: 'latency',
              stream: 'downstream',
              toxicity: 1,
              attributes: { latency: 750, jitter: 80 },
            } satisfies Toxic,
          }

    const url = `${this.baseUrl}/proxies/${configuration.proxy}/toxics/${configuration.toxic.name}`
    const response = enabled
      ? await fetch(`${this.baseUrl}/proxies/${configuration.proxy}/toxics`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(configuration.toxic),
        })
      : await fetch(url, { method: 'DELETE' })

    if (!response.ok && !(response.status === 404 && !enabled)) {
      throw new ServiceUnavailableException(`Toxiproxy returned ${response.status}`)
    }
  }

  async getFaults(): Promise<Record<FaultName, boolean>> {
    try {
      const [redis, postgres] = await Promise.all([
        fetch(`${this.baseUrl}/proxies/redis`).then((response) => response.json()),
        fetch(`${this.baseUrl}/proxies/postgres`).then((response) => response.json()),
      ])
      const hasToxic = (value: unknown, name: string) =>
        Array.isArray((value as { toxics?: unknown[] }).toxics) &&
        (value as { toxics: { name?: string }[] }).toxics.some((toxic) => toxic.name === name)
      return {
        'redis-outage': hasToxic(redis, 'cache-cut'),
        'slow-origin': hasToxic(postgres, 'origin-latency'),
      }
    } catch {
      return { 'redis-outage': false, 'slow-origin': false }
    }
  }
}
