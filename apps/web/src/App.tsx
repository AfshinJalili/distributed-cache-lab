import { useMemo, useState } from 'react'
import {
  resourceKeys,
  type CacheEntryView,
  type FaultName,
  type ResourceKey,
} from '@dcl/contracts'
import { useLab } from './useLab'

const resourceMeta: Record<ResourceKey, { label: string; shape: string }> = {
  'product:42': { label: 'Product 42', shape: 'JSON · hot key' },
  'flags:global': { label: 'Global flags', shape: 'JSON · freshness' },
  'catalog:home': { label: 'Home catalog', shape: 'JSON · aggregate' },
  'pricing:pro': { label: 'Pro pricing', shape: 'JSON · writes' },
  'product:404': { label: 'Missing product', shape: 'negative cache' },
}

function clock(value: number): string {
  return new Date(value).toISOString().slice(11, 19)
}

function averageLatency(requests: number, total: number): number {
  return requests ? Math.round(total / requests) : 0
}

function CacheSlot({ entry, index }: { entry?: CacheEntryView; index: number }) {
  if (!entry) {
    return (
      <div className="cache-slot is-empty">
        <span className="slot-index">0{index + 1}</span>
        <strong>Empty slot</strong>
        <small>waiting for a real fill</small>
      </div>
    )
  }
  return (
    <div className={`cache-slot is-${entry.health}`}>
      <span className="slot-index">0{index + 1}</span>
      <span className="slot-status">{entry.health}</span>
      <strong>{entry.key}</strong>
      <small>
        {entry.negative ? 'not-found sentinel' : `v${entry.version}`} · {entry.hits} hits
      </small>
      <span className="slot-ttl">
        {entry.ttlRemainingSeconds > 0 ? `${entry.ttlRemainingSeconds}s soft TTL` : 'soft TTL crossed'}
      </span>
    </div>
  )
}

function Toggle({
  label,
  detail,
  checked,
  onClick,
  disabled,
}: {
  label: string
  detail: string
  checked: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="state-toggle"
      aria-pressed={checked}
      onClick={onClick}
      disabled={disabled}
    >
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <i aria-hidden="true" />
    </button>
  )
}

export default function App() {
  const lab = useLab()
  const [selectedKey, setSelectedKey] = useState<ResourceKey>('product:42')
  const state = lab.state
  const trace = lab.trace

  const summary = useMemo(() => {
    const metrics = state?.metrics
    if (!metrics) return { hitRate: 0, latency: 0, shield: 100 }
    return {
      hitRate: metrics.requests ? Math.round((metrics.hits / metrics.requests) * 100) : 0,
      latency: averageLatency(metrics.requests, metrics.totalLatencyMs),
      shield: metrics.requests
        ? Math.max(0, Math.round((1 - metrics.originReads / metrics.requests) * 100))
        : 100,
    }
  }, [state])

  if (!state) {
    return (
      <main className="boot-screen">
        <span>CL</span>
        <p>Connecting to the distributed cache lab…</p>
        {lab.error && <strong>{lab.error}</strong>}
      </main>
    )
  }

  const selectedEntry = state.entries.find((entry) => entry.key === selectedKey)
  const slots = Array.from(
    { length: state.settings.capacity },
    (_, index) => state.entries[index],
  )
  const working = lab.busy !== null

  const changeFault = (name: FaultName) => {
    void lab.fault(name, !state.faults[name])
  }

  return (
    <div className="cache-lab">
      <header className="lab-header">
        <a className="lab-brand" href="https://github.com/AfshinJalili/distributed-cache-lab">
          <span className="brand-mark">CL</span>
          <span>
            <strong>Cache Lab</strong>
            <small>distributed caching / live infrastructure</small>
          </span>
        </a>
        <div className="lab-health">
          <span className={`pulse-dot ${lab.error ? 'is-warning' : ''}`} />
          <span>
            {lab.error ? 'stream recovering' : 'systems online'}
            <small>
              {state.instances.filter((item) => item.role === 'api').length} API ·{' '}
              {state.instances.filter((item) => item.role === 'worker').length} worker
            </small>
          </span>
        </div>
        <div className="header-metrics">
          <span>
            hit rate <strong>{summary.hitRate}%</strong>
          </span>
          <span>
            avg latency <strong>{summary.latency} ms</strong>
          </span>
          <span>
            origin shield <strong>{summary.shield}%</strong>
          </span>
        </div>
        <button className="reset-button" type="button" disabled={working} onClick={() => void lab.reset()}>
          Reset drill ↺
        </button>
      </header>

      {lab.error && <div className="error-banner">{lab.error}</div>}

      <main className="lab-layout">
        <aside className="control-rack">
          <div className="panel-heading">
            <span>01</span>
            <div>
              <strong>Shape the system</strong>
              <small>shared across every replica</small>
            </div>
          </div>

          <label className="range-control">
            <span>
              Soft TTL <strong>{state.settings.ttlSeconds}s</strong>
            </span>
            <input
              type="range"
              min="5"
              max="90"
              step="5"
              value={state.settings.ttlSeconds}
              disabled={working}
              onChange={(event) =>
                void lab.patchSettings({ ttlSeconds: Number(event.currentTarget.value) })
              }
            />
            <small>
              <span>freshness</span>
              <span>fewer misses</span>
            </small>
          </label>

          <label className="range-control">
            <span>
              Pool capacity <strong>{state.settings.capacity} slots</strong>
            </span>
            <input
              type="range"
              min="2"
              max="6"
              value={state.settings.capacity}
              disabled={working}
              onChange={(event) =>
                void lab.patchSettings({ capacity: Number(event.currentTarget.value) })
              }
            />
            <small>
              <span>lean</span>
              <span>roomy</span>
            </small>
          </label>

          <div className="segment-control">
            <span>Eviction policy</span>
            <div>
              {(['LRU', 'LFU'] as const).map((policy) => (
                <button
                  type="button"
                  key={policy}
                  aria-pressed={state.settings.eviction === policy}
                  disabled={working}
                  onClick={() => void lab.patchSettings({ eviction: policy })}
                >
                  {policy}
                </button>
              ))}
            </div>
          </div>

          <div className="toggle-stack">
            <Toggle
              label="Request coalescing"
              detail="Redis per-key single-flight"
              checked={state.settings.coalescing}
              disabled={working}
              onClick={() =>
                void lab.patchSettings({ coalescing: !state.settings.coalescing })
              }
            />
            <Toggle
              label="Stale-while-revalidate"
              detail="BullMQ durable refresh"
              checked={state.settings.staleWhileRevalidate}
              disabled={working}
              onClick={() =>
                void lab.patchSettings({
                  staleWhileRevalidate: !state.settings.staleWhileRevalidate,
                })
              }
            />
            <Toggle
              label="TTL jitter"
              detail="spread synchronized expiry"
              checked={state.settings.ttlJitter}
              disabled={working}
              onClick={() =>
                void lab.patchSettings({ ttlJitter: !state.settings.ttlJitter })
              }
            />
          </div>

          <div className="segment-control write-policy">
            <span>Write path</span>
            <div>
              <button
                type="button"
                aria-pressed={state.settings.writePolicy === 'invalidate'}
                disabled={working}
                onClick={() => void lab.patchSettings({ writePolicy: 'invalidate' })}
              >
                Invalidate
              </button>
              <button
                type="button"
                aria-pressed={state.settings.writePolicy === 'write-through'}
                disabled={working}
                onClick={() => void lab.patchSettings({ writePolicy: 'write-through' })}
              >
                Through
              </button>
            </div>
          </div>

          <div className="fault-controls">
            <span>Failure drills / Toxiproxy</span>
            <Toggle
              label="Redis outage"
              detail="circuit-breaker bypass"
              checked={state.faults['redis-outage']}
              disabled={lab.busy === 'fault:redis-outage'}
              onClick={() => changeFault('redis-outage')}
            />
            <Toggle
              label="Slow origin"
              detail="+750ms PostgreSQL latency"
              checked={state.faults['slow-origin']}
              disabled={lab.busy === 'fault:slow-origin'}
              onClick={() => changeFault('slow-origin')}
            />
          </div>

          <button className="flush-button" type="button" disabled={working} onClick={() => void lab.flush()}>
            Flush cache <span>⌫</span>
          </button>
        </aside>

        <section className="workbench">
          <div className="workbench-head">
            <div>
              <span className="eyebrow">Live request path</span>
              <h1>See every trade-off move.</h1>
              <p>
                Every action crosses Nginx, a real API replica, Redis, and—on a miss—PostgreSQL.
              </p>
            </div>
            <div className={`result-card result-${(trace?.result ?? 'HIT').toLowerCase()}`}>
              <small>last response</small>
              <strong>{trace?.result ?? 'READY'}</strong>
              <span>{trace?.latencyMs ?? 0} ms</span>
            </div>
          </div>

          <div className="key-picker" aria-label="Resource key">
            {resourceKeys.map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={selectedKey === key}
                onClick={() => setSelectedKey(key)}
              >
                <span>{resourceMeta[key].label}</span>
                <small>{key}</small>
              </button>
            ))}
          </div>

          <div className="topology" aria-label="Distributed request topology">
            <div className="topology-node">
              <span className="node-icon">⌁</span>
              <small>01 / ingress</small>
              <strong>Client</strong>
              <span>SSE + HTTP</span>
            </div>
            <span className="topology-link"><i />HTTP</span>
            <div className="topology-node">
              <span className="node-icon">◇</span>
              <small>02 / balance</small>
              <strong>Nginx</strong>
              <span>2 API replicas</span>
            </div>
            <span className="topology-link"><i />GET</span>
            <div className="topology-node node-cache">
              <span className="node-icon">▤</span>
              <small>03 / fast path</small>
              <strong>Redis 7</strong>
              <span>{state.entries.length} / {state.settings.capacity} slots</span>
            </div>
            <span className="topology-link"><i />MISS</span>
            <div className="topology-node node-origin">
              <span className="node-icon">◎</span>
              <small>04 / source</small>
              <strong>PostgreSQL</strong>
              <span>{state.metrics.originReads} reads observed</span>
            </div>
          </div>

          <div className="action-row">
            <button
              type="button"
              className="primary-action"
              disabled={working}
              onClick={() => void lab.read(selectedKey)}
            >
              <span>GET</span> {selectedKey} <kbd>↵</kbd>
            </button>
            <button type="button" disabled={working} onClick={() => void lab.burst(selectedKey)}>
              Burst ×16 <small>cross-replica stampede</small>
            </button>
            <button type="button" disabled={working} onClick={() => void lab.advance(15)}>
              Clock +15s <small>shared logical time</small>
            </button>
            <button
              type="button"
              disabled={working || selectedKey === 'product:404'}
              onClick={() => void lab.write(selectedKey)}
            >
              Write origin <small>transaction + outbox</small>
            </button>
          </div>

          <div className="cache-rack">
            <div className="rack-heading">
              <span>Redis memory / {state.settings.capacity} bounded slots</span>
              <small>
                {state.settings.eviction} · soft TTL {state.settings.ttlSeconds}s
                {state.settings.ttlJitter ? ' ± jitter' : ''}
              </small>
            </div>
            <div className="rack-slots">
              {slots.map((slot, index) => (
                <CacheSlot key={slot?.key ?? `empty-${index}`} entry={slot} index={index} />
              ))}
            </div>
          </div>

          <div className="principles">
            <div>
              <span>Latency</span>
              <strong>{summary.latency || '—'} ms</strong>
              <p>Prometheus observes every real request outcome.</p>
            </div>
            <div>
              <span>Consistency</span>
              <strong>
                {selectedEntry?.originVersion !== null &&
                selectedEntry &&
                selectedEntry.version < (selectedEntry.originVersion ?? 0)
                  ? 'version drift'
                  : 'aligned'}
              </strong>
              <p>PostgreSQL and cached versions stay inspectable.</p>
            </div>
            <div>
              <span>Protection</span>
              <strong>{state.metrics.coalesced} collapsed</strong>
              <p>Distributed locks turn a herd into one origin read.</p>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="panel-heading">
            <span>02</span>
            <div>
              <strong>Inspect the outcome</strong>
              <small>real state + traces</small>
            </div>
          </div>

          <section className="trace-detail">
            <div className="inspector-title">
              <span>Trace {trace?.traceId?.slice(0, 8) ?? trace?.id.slice(-8) ?? '—'}</span>
              <strong>{trace?.key ?? selectedKey}</strong>
            </div>
            <ol>
              {(trace?.hops ?? ['client', 'Nginx', 'Redis', 'PostgreSQL']).map((hop, index) => (
                <li key={`${trace?.id ?? 'initial'}-${hop}-${index}`}>
                  <span>{(index + 1).toString().padStart(2, '0')}</span>
                  <i />
                  <strong>{hop}</strong>
                </li>
              ))}
            </ol>
            <p>{trace?.note ?? 'Run a request to inspect its distributed path.'}</p>
            <div className="trace-links">
              <a href="http://localhost:16686" target="_blank" rel="noreferrer">
                Jaeger ↗
              </a>
              <a href="http://localhost:19090" target="_blank" rel="noreferrer">
                Prometheus ↗
              </a>
            </div>
          </section>

          <section className="selected-state">
            <div>
              <span>Selected cache state</span>
              <strong className={selectedEntry ? `is-${selectedEntry.health}` : 'is-absent'}>
                {selectedEntry?.health ?? 'absent'}
              </strong>
            </div>
            <dl>
              <div>
                <dt>cache version</dt>
                <dd>{selectedEntry ? `v${selectedEntry.version}` : '—'}</dd>
              </div>
              <div>
                <dt>origin version</dt>
                <dd>
                  {state.originVersions[selectedKey] !== undefined
                    ? `v${state.originVersions[selectedKey]}`
                    : 'not found'}
                </dd>
              </div>
              <div>
                <dt>soft TTL</dt>
                <dd>{selectedEntry ? `${selectedEntry.ttlRemainingSeconds}s` : '—'}</dd>
              </div>
              <div>
                <dt>frequency</dt>
                <dd>{selectedEntry?.hits ?? 0} hits</dd>
              </div>
            </dl>
          </section>

          <section className="runtime-state">
            <div className="event-heading">
              <span>Runtime topology</span>
              <i>live</i>
            </div>
            <div className="instance-list">
              {state.instances.map((instance) => (
                <span key={instance.id}>
                  <i />
                  <strong>{instance.id}</strong>
                  <small>{instance.role}</small>
                </span>
              ))}
            </div>
          </section>

          <section className="event-stream">
            <div className="event-heading">
              <span>Redis Stream</span>
              <i>{clock(state.now)}</i>
            </div>
            <div>
              {lab.events.slice(0, 9).map((event) => (
                <article key={event.id}>
                  <span className={`event-kind kind-${event.kind}`} />
                  <time>{clock(event.at)}</time>
                  <p>
                    <strong>{event.title}</strong>
                    <small>{event.detail}</small>
                  </p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}
