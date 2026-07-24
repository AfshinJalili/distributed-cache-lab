import type {
  LabEvent,
  LabState,
  RequestTrace,
  ResourceKey,
} from '@dcl/contracts'

function clock(value: number): string {
  return new Date(value).toISOString().slice(11, 19)
}

export function Inspector({
  state,
  events,
  trace,
  selectedKey,
}: {
  state: LabState
  events: LabEvent[]
  trace: RequestTrace | null
  selectedKey: ResourceKey
}) {
  const selectedEntry = state.entries.find((entry) => entry.key === selectedKey)

  return (
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
          {events.slice(0, 9).map((event) => (
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
  )
}
