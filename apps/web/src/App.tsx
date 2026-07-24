import { useMemo, useState } from 'react'
import type { ResourceKey } from '@dcl/contracts'
import { ControlRack } from './components/ControlRack'
import { Inspector } from './components/Inspector'
import { Workbench, type LabSummary } from './components/Workbench'
import { useLab } from './useLab'

function averageLatency(requests: number, total: number): number {
  return requests ? Math.round(total / requests) : 0
}

export default function App() {
  const lab = useLab()
  const [selectedKey, setSelectedKey] = useState<ResourceKey>('product:42')
  const state = lab.state
  const trace = lab.trace

  const summary = useMemo<LabSummary>(() => {
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

  const working = lab.busy !== null

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
        <ControlRack
          state={state}
          busy={lab.busy}
          onPatch={(patch) => void lab.patchSettings(patch)}
          onFault={(name) => void lab.fault(name, !state.faults[name])}
          onFlush={() => void lab.flush()}
        />
        <Workbench
          state={state}
          trace={trace}
          summary={summary}
          selectedKey={selectedKey}
          working={working}
          onSelect={setSelectedKey}
          onRead={(key) => void lab.read(key)}
          onBurst={(key) => void lab.burst(key)}
          onAdvance={(seconds) => void lab.advance(seconds)}
          onWrite={(key) => void lab.write(key)}
        />
        <Inspector
          state={state}
          events={lab.events}
          trace={trace}
          selectedKey={selectedKey}
        />
      </main>
    </div>
  )
}
