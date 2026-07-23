import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const baseUrl = __ENV.DCL_BASE_URL || 'http://localhost:5175/api'
const cacheHits = new Counter('cache_hits')
const cacheMisses = new Counter('cache_misses')
const responseTime = new Trend('cache_response_time', true)

export const options = {
  scenarios: {
    warm_reads: {
      executor: 'constant-vus',
      vus: 20,
      duration: '20s',
    },
    hot_key_spike: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      stages: [
        { target: 100, duration: '5s' },
        { target: 100, duration: '10s' },
        { target: 0, duration: '5s' },
      ],
      startTime: '22s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    cache_response_time: ['p(95)<250'],
  },
}

export function setup() {
  http.post(`${baseUrl}/lab/reset`)
  http.get(`${baseUrl}/resources/product%3A42`)
}

export default function () {
  const response = http.get(`${baseUrl}/resources/product%3A42`)
  const result = response.headers['X-Cache-Result']
  if (result === 'HIT') cacheHits.add(1)
  if (result === 'MISS') cacheMisses.add(1)
  responseTime.add(response.timings.duration)
  check(response, {
    'resource returned': (value) => value.status === 200,
    'cache status exposed': (value) => Boolean(value.headers['Cache-Status']),
  })
  sleep(0.05)
}
