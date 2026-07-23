import { randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import { keys } from './keys'

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

export type LockLease = {
  key: string
  token: string
}

export class DistributedLock {
  constructor(private readonly redis: Redis) {}

  async acquire(resourceKey: string, ttlMs = 2000): Promise<LockLease | null> {
    const key = `${keys.lockPrefix}${resourceKey}`
    const token = randomUUID()
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX')
    return result === 'OK' ? { key, token } : null
  }

  async release(lease: LockLease): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, lease.key, lease.token)
  }
}
