import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./useLab', () => ({
  useLab: () => ({
    state: {
      now: Date.now(),
      settings: {
        ttlSeconds: 30,
        staleWindowSeconds: 45,
        negativeTtlSeconds: 8,
        capacity: 4,
        eviction: 'LRU',
        coalescing: true,
        staleWhileRevalidate: false,
        ttlJitter: true,
        writePolicy: 'invalidate',
      },
      entries: [],
      originVersions: { 'product:42': 12 },
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
      faults: { 'redis-outage': false, 'slow-origin': false },
      lastTrace: null,
    },
    events: [],
    error: null,
    busy: null,
    trace: null,
    read: vi.fn(),
    burst: vi.fn(),
    patchSettings: vi.fn(),
    advance: vi.fn(),
    write: vi.fn(),
    flush: vi.fn(),
    reset: vi.fn(),
    fault: vi.fn(),
  }),
}))

describe('Cache Lab UI', () => {
  it('renders the promoted request microscope with real-infrastructure controls', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'See every trade-off move.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Burst ×16/ })).toBeInTheDocument()
    expect(screen.getByText('Redis outage')).toBeInTheDocument()
    expect(screen.getAllByText('PostgreSQL')).toHaveLength(2)
  })
})
