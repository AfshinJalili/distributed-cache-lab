import type {
  CacheSettings,
  FaultName,
  LabEvent,
  LabState,
  ResourceKey,
  ResourceResponse,
  WriteResourceResponse,
} from '@dcl/contracts'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await response.json()) as T
  if (!response.ok && response.status !== 404) {
    throw new Error(`Request failed (${response.status})`)
  }
  return body
}

export const api = {
  state: () => json<LabState>('/api/lab/state'),
  recentEvents: () => json<LabEvent[]>('/api/lab/events/recent'),
  read: (key: ResourceKey) =>
    json<ResourceResponse>(`/api/resources/${encodeURIComponent(key)}`),
  write: (key: ResourceKey) =>
    json<WriteResourceResponse>(`/api/resources/${encodeURIComponent(key)}/write`, {
      method: 'POST',
    }),
  patchSettings: (patch: Partial<CacheSettings>) =>
    json<CacheSettings>('/api/lab/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  advance: (seconds: number) =>
    json<{ now: number }>('/api/lab/clock/advance', {
      method: 'POST',
      body: JSON.stringify({ seconds }),
    }),
  flush: () => json<{ ok: true }>('/api/lab/flush', { method: 'POST' }),
  reset: () => json<LabState>('/api/lab/reset', { method: 'POST' }),
  fault: (name: FaultName, enabled: boolean) =>
    json<{ name: FaultName; enabled: boolean }>(`/api/lab/faults/${name}`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
}
