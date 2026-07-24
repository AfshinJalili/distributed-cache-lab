import {
  faultDefinitions,
  faultNames,
  type CacheSettings,
  type FaultName,
  type LabState,
} from '@dcl/contracts'

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

export function ControlRack({
  state,
  busy,
  onPatch,
  onFault,
  onFlush,
}: {
  state: LabState
  busy: string | null
  onPatch: (patch: Partial<CacheSettings>) => void
  onFault: (name: FaultName) => void
  onFlush: () => void
}) {
  const working = busy !== null

  return (
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
          onChange={(event) => onPatch({ ttlSeconds: Number(event.currentTarget.value) })}
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
          onChange={(event) => onPatch({ capacity: Number(event.currentTarget.value) })}
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
              onClick={() => onPatch({ eviction: policy })}
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
          onClick={() => onPatch({ coalescing: !state.settings.coalescing })}
        />
        <Toggle
          label="Stale-while-revalidate"
          detail="BullMQ durable refresh"
          checked={state.settings.staleWhileRevalidate}
          disabled={working}
          onClick={() =>
            onPatch({
              staleWhileRevalidate: !state.settings.staleWhileRevalidate,
            })
          }
        />
        <Toggle
          label="TTL jitter"
          detail="spread synchronized expiry"
          checked={state.settings.ttlJitter}
          disabled={working}
          onClick={() => onPatch({ ttlJitter: !state.settings.ttlJitter })}
        />
      </div>

      <div className="segment-control write-policy">
        <span>Write path</span>
        <div>
          <button
            type="button"
            aria-pressed={state.settings.writePolicy === 'invalidate'}
            disabled={working}
            onClick={() => onPatch({ writePolicy: 'invalidate' })}
          >
            Invalidate
          </button>
          <button
            type="button"
            aria-pressed={state.settings.writePolicy === 'write-through'}
            disabled={working}
            onClick={() => onPatch({ writePolicy: 'write-through' })}
          >
            Through
          </button>
        </div>
      </div>

      <div className="fault-controls">
        <span>Failure drills / Toxiproxy</span>
        {faultNames.map((name) => (
          <Toggle
            key={name}
            label={faultDefinitions[name].label}
            detail={faultDefinitions[name].detail}
            checked={state.faults[name]}
            disabled={busy === `fault:${name}`}
            onClick={() => onFault(name)}
          />
        ))}
      </div>

      <button className="flush-button" type="button" disabled={working} onClick={onFlush}>
        Flush cache <span>⌫</span>
      </button>
    </aside>
  )
}
