import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CacheResult,
  CacheSettings,
  FaultName,
  LabEvent,
  LabState,
  RequestTrace,
  ResourceKey,
} from '@dcl/contracts'
import { api } from './api'

export function useLab() {
  const [state, setState] = useState<LabState | null>(null)
  const [events, setEvents] = useState<LabEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const localTrace = useRef<RequestTrace | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.state()
      setState(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lab state unavailable')
    }
  }, [])

  useEffect(() => {
    void Promise.all([
      refresh(),
      api.recentEvents().then(setEvents).catch(() => undefined),
    ])
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const stream = new EventSource('/api/lab/events')
    stream.addEventListener('cache-event', (message) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as Omit<LabEvent, 'id'>
      const id = (message as MessageEvent<string>).lastEventId
      setEvents((current) => [{ id, ...event }, ...current.filter((item) => item.id !== id)].slice(0, 30))
      void refresh()
    })
    stream.addEventListener('error', () => setError('Live stream reconnecting…'))
    return () => stream.close()
  }, [refresh])

  const run = useCallback(
    async <T,>(name: string, operation: () => Promise<T>): Promise<T | undefined> => {
      setBusy(name)
      setError(null)
      try {
        const result = await operation()
        await refresh()
        return result
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Action failed')
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const read = useCallback(
    async (key: ResourceKey) => {
      const response = await run(`read:${key}`, () => api.read(key))
      if (response) {
        const cache = response.cache
        localTrace.current = {
          id: `browser-${Date.now()}`,
          key,
          result: cache.result,
          latencyMs: 0,
          instanceId: cache.instanceId,
          hops: ['client', cache.instanceId, `cache · ${cache.result}`],
          note: cache.result === 'BYPASS' ? 'Circuit breaker bypassed Redis.' : 'Request completed.',
        }
      }
    },
    [run],
  )

  const burst = useCallback(
    async (key: ResourceKey) => {
      const responses = await run('burst', () =>
        Promise.all(Array.from({ length: 16 }, () => api.read(key))),
      )
      const last = responses?.at(-1)
      if (last) {
        localTrace.current = {
          id: `burst-${Date.now()}`,
          key,
          result: last.cache.result as CacheResult,
          latencyMs: 0,
          instanceId: last.cache.instanceId,
          hops: ['16 concurrent clients', 'Nginx · two API replicas', 'Redis single-flight', 'origin'],
          note: 'Compare origin reads with request coalescing on and off.',
        }
      }
    },
    [run],
  )

  return {
    state,
    events,
    error,
    busy,
    trace: state?.lastTrace ?? localTrace.current,
    read,
    burst,
    patchSettings: (patch: Partial<CacheSettings>) =>
      run('settings', () => api.patchSettings(patch)),
    advance: (seconds: number) => run('clock', () => api.advance(seconds)),
    write: (key: ResourceKey) => run('write', () => api.write(key)),
    flush: () => run('flush', api.flush),
    reset: () => run('reset', api.reset),
    fault: (name: FaultName, enabled: boolean) =>
      run(`fault:${name}`, () => api.fault(name, enabled)),
  }
}
