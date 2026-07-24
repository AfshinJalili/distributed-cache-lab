import assert from 'node:assert/strict'

const baseUrl = process.env.DCL_BASE_URL ?? 'http://localhost:5175/api'

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  assert.ok(response.ok || response.status === 404, `${path} returned ${response.status}`)
  return { response, body }
}

async function waitFor(predicate, timeoutMs = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Timed out waiting for condition')
}

await request('/lab/reset', { method: 'POST' })
await request('/lab/flush', { method: 'POST' })

const miss = await request('/resources/product%3A42')
assert.equal(miss.response.headers.get('x-cache-result'), 'MISS')
const hit = await request('/resources/product%3A42')
assert.equal(hit.response.headers.get('x-cache-result'), 'HIT')
assert.notEqual(
  miss.response.headers.get('x-instance-id'),
  null,
  'load-balanced API instance must identify itself',
)

await request('/lab/reset', { method: 'POST' })
await request('/lab/flush', { method: 'POST' })
const burst = await Promise.all(
  Array.from({ length: 16 }, () => request('/resources/catalog%3Ahome')),
)
const burstResults = burst.map(({ response }) => response.headers.get('x-cache-result'))
assert.equal(
  burstResults.filter((result) => result === 'MISS').length,
  1,
  'only the lock owner should report a cold miss',
)
assert.equal(
  burstResults.filter((result) => result === 'HIT').length,
  15,
  'coalesced waiters should report hits after re-reading the fill',
)
const burstState = (await request('/lab/state')).body
assert.equal(burstState.metrics.originReads, 1, 'coalesced cold burst must perform one origin read')
assert.equal(burstState.metrics.misses, 1, 'only the lock owner should count as a miss')
assert.equal(burstState.metrics.hits, 15, 'coalesced waiters should count as cache hits')
assert.equal(burstState.metrics.coalesced, 15, 'every waiter should be recorded as coalesced')

await request('/lab/flush', { method: 'POST' })
const firstMissing = await request('/resources/product%3A404')
assert.equal(firstMissing.response.headers.get('x-cache-result'), 'MISS')
const cachedMissing = await request('/resources/product%3A404')
assert.equal(cachedMissing.response.headers.get('x-cache-result'), 'NEGATIVE_HIT')

await request('/lab/reset', { method: 'POST' })
await request('/lab/flush', { method: 'POST' })
await request('/lab/settings', {
  method: 'PATCH',
  body: JSON.stringify({
    ttlSeconds: 5,
    staleWindowSeconds: 30,
    staleWhileRevalidate: true,
    ttlJitter: false,
  }),
})
const swrWarm = await request('/resources/product%3A42')
assert.equal(swrWarm.response.headers.get('x-cache-result'), 'MISS')
await request('/lab/clock/advance', {
  method: 'POST',
  body: JSON.stringify({ seconds: 6 }),
})
const staleBurst = await Promise.all(
  Array.from({ length: 8 }, () => request('/resources/product%3A42')),
)
assert.ok(
  staleBurst.some(({ response }) => response.headers.get('x-cache-result') === 'STALE'),
  'soft-expired data should be served while refresh runs',
)
const refreshedState = await waitFor(async () => {
  const next = (await request('/lab/state')).body
  const entry = next.entries.find((item) => item.key === 'product:42')
  return entry?.health === 'fresh' && next.metrics.originReads === 2 ? next : undefined
})
assert.equal(
  refreshedState.metrics.originReads,
  2,
  'a stale burst should add exactly one background origin read',
)

await request('/lab/reset', { method: 'POST' })
const pricingBeforeWrite = await request('/resources/pricing%3Apro')
assert.equal(pricingBeforeWrite.response.headers.get('x-cache-result'), 'MISS')
const pricingHit = await request('/resources/pricing%3Apro')
assert.equal(pricingHit.response.headers.get('x-cache-result'), 'HIT')
const write = await request('/resources/pricing%3Apro/write', { method: 'POST' })
assert.equal(write.body.reconciliation, 'pending')
await waitFor(async () => {
  const reconciled = await request('/resources/pricing%3Apro')
  return (
    reconciled.body.resource?.version === write.body.version &&
    reconciled.response.headers.get('x-cache-result') === 'MISS'
  )
})

await request('/lab/reset', { method: 'POST' })
await request('/lab/settings', {
  method: 'PATCH',
  body: JSON.stringify({ writePolicy: 'write-through', ttlJitter: false }),
})
await request('/resources/pricing%3Apro')
const writeThrough = await request('/resources/pricing%3Apro/write', { method: 'POST' })
await waitFor(async () => {
  const reconciled = await request('/resources/pricing%3Apro')
  return (
    reconciled.body.resource?.version === writeThrough.body.version &&
    reconciled.response.headers.get('x-cache-result') === 'HIT'
  )
})

await request('/lab/faults/redis-outage', {
  method: 'POST',
  body: JSON.stringify({ enabled: true }),
})
await new Promise((resolve) => setTimeout(resolve, 250))
const bypass = await request('/resources/product%3A42')
assert.equal(bypass.response.headers.get('x-cache-result'), 'BYPASS')
await request('/lab/faults/redis-outage', {
  method: 'POST',
  body: JSON.stringify({ enabled: false }),
})

console.log(
  'E2E passed: coalescing, negative cache, SWR, invalidate/write-through outbox, and cache bypass',
)
