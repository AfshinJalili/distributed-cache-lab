import Redis, { type RedisOptions } from 'ioredis'

export function redisOptions(): RedisOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 26379),
    connectTimeout: 500,
    commandTimeout: 800,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: (attempt) => Math.min(50 * attempt, 500),
  }
}

export function createRedis(overrides: RedisOptions = {}): Redis {
  const client = new Redis({ ...redisOptions(), ...overrides })
  // Operation boundaries record failures; a listener prevents ioredis from also
  // printing an unstructured "Unhandled error event" during outage drills.
  client.on('error', () => undefined)
  return client
}

export function bullConnectionOptions(): RedisOptions {
  return {
    ...redisOptions(),
    maxRetriesPerRequest: null,
    commandTimeout: undefined,
  }
}

export function bullQueueConnectionOptions(): RedisOptions {
  return redisOptions()
}
