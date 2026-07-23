import assert from 'node:assert/strict'

const baseUrl = process.env.DCL_BASE_URL ?? 'http://localhost:5175/api'

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json()
  assert.ok(response.ok, `${path} returned ${response.status}`)
  return { response, body }
}

await request('/lab/reset', { method: 'POST' })
await request('/resources/pricing%3Apro')
const warm = await request('/resources/pricing%3Apro')
assert.equal(warm.response.headers.get('x-cache-result'), 'HIT')

const write = await request('/resources/pricing%3Apro/write', { method: 'POST' })
assert.equal(write.response.status, 202)

const deadline = Date.now() + 5000
let reconciled = false
while (Date.now() < deadline) {
  const read = await request('/resources/pricing%3Apro')
  if (
    read.body.resource?.version === write.body.version &&
    read.response.headers.get('x-cache-result') === 'MISS'
  ) {
    reconciled = true
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
}

assert.ok(reconciled, 'outbox worker must invalidate the warmed entry within 5 seconds')
console.log('Outbox E2E passed: commit returned 202 and worker invalidated the warmed cache entry')
