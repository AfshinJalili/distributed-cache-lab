import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { faultNames } from '@dcl/contracts'
import type { FaultName } from '@dcl/contracts'

type Toxic = {
  name: string
  type: string
  stream: 'downstream'
  toxicity: number
  attributes: Record<string, number>
}

const faultConfigurations: Record<FaultName, { proxy: string; toxic: Toxic }> = {
  'redis-outage': {
    proxy: 'redis',
    toxic: {
      name: 'cache-cut',
      type: 'timeout',
      stream: 'downstream',
      toxicity: 1,
      attributes: { timeout: 1 },
    },
  },
  'slow-origin': {
    proxy: 'postgres',
    toxic: {
      name: 'origin-latency',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: 750, jitter: 80 },
    },
  },
}

@Injectable()
export class ToxiproxyService {
  private readonly baseUrl = process.env.TOXIPROXY_URL ?? 'http://localhost:8474'

  async setFault(name: FaultName, enabled: boolean): Promise<void> {
    const configuration = faultConfigurations[name]

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
      const hasToxic = (value: unknown, name: string) =>
        Array.isArray((value as { toxics?: unknown[] }).toxics) &&
        (value as { toxics: { name?: string }[] }).toxics.some((toxic) => toxic.name === name)
      const states = await Promise.all(
        faultNames.map(async (name) => {
          const configuration = faultConfigurations[name]
          const response = await fetch(`${this.baseUrl}/proxies/${configuration.proxy}`)
          if (!response.ok) throw new Error(`Toxiproxy returned ${response.status}`)
          return [name, hasToxic(await response.json(), configuration.toxic.name)] as const
        }),
      )
      return Object.fromEntries(states) as Record<FaultName, boolean>
    } catch {
      return { 'redis-outage': false, 'slow-origin': false }
    }
  }
}
