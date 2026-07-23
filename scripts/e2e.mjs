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
await Promise.all(Array.from({ length: 16 }, () => request('/resources/catalog%3Ahome')))
const burstState = (await request('/lab/state')).body
assert.equal(burstState.metrics.originReads, 1, 'coalesced cold burst must perform one origin read')
assert.ok(burstState.metrics.coalesced >= 1, 'cold burst must collapse at least one waiter')

await request('/lab/flush', { method: 'POST' })
const firstMissing = await request('/resources/product%3A404')
assert.equal(firstMissing.response.headers.get('x-cache-result'), 'MISS')
const cachedMissing = await request('/resources/product%3A404')
assert.equal(cachedMissing.response.headers.get('x-cache-result'), 'NEGATIVE_HIT')

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

console.log('E2E passed: miss/hit, cross-replica coalescing, negative cache, outbox, and cache bypass')
