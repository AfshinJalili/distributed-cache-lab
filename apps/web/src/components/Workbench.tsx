import {
  resourceKeys,
  type CacheEntryView,
  type LabState,
  type RequestTrace,
  type ResourceKey,
} from '@dcl/contracts'

const resourceMeta: Record<ResourceKey, { label: string; shape: string }> = {
  'product:42': { label: 'Product 42', shape: 'JSON · hot key' },
  'flags:global': { label: 'Global flags', shape: 'JSON · freshness' },
  'catalog:home': { label: 'Home catalog', shape: 'JSON · aggregate' },
  'pricing:pro': { label: 'Pro pricing', shape: 'JSON · writes' },
  'product:404': { label: 'Missing product', shape: 'negative cache' },
}

export type LabSummary = {
  hitRate: number
  latency: number
  shield: number
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

export function Workbench({
  state,
  trace,
  summary,
  selectedKey,
  working,
  onSelect,
  onRead,
  onBurst,
  onAdvance,
  onWrite,
}: {
  state: LabState
  trace: RequestTrace | null
  summary: LabSummary
  selectedKey: ResourceKey
  working: boolean
  onSelect: (key: ResourceKey) => void
  onRead: (key: ResourceKey) => void
  onBurst: (key: ResourceKey) => void
  onAdvance: (seconds: number) => void
  onWrite: (key: ResourceKey) => void
}) {
  const selectedEntry = state.entries.find((entry) => entry.key === selectedKey)
  const slots = Array.from(
    { length: state.settings.capacity },
    (_, index) => state.entries[index],
  )

  return (
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
            onClick={() => onSelect(key)}
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
          onClick={() => onRead(selectedKey)}
        >
          <span>GET</span> {selectedKey} <kbd>↵</kbd>
        </button>
        <button type="button" disabled={working} onClick={() => onBurst(selectedKey)}>
          Burst ×16 <small>cross-replica stampede</small>
        </button>
        <button type="button" disabled={working} onClick={() => onAdvance(15)}>
          Clock +15s <small>shared logical time</small>
        </button>
        <button
          type="button"
          disabled={working || selectedKey === 'product:404'}
          onClick={() => onWrite(selectedKey)}
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
  )
}
