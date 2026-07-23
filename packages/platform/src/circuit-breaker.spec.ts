import { CircuitBreaker } from './circuit-breaker'

describe('CircuitBreaker', () => {
  it('opens after the configured number of failures and recovers later', async () => {
    jest.useFakeTimers()
    const breaker = new CircuitBreaker(2, 1000)
    const failure = async () => {
      throw new Error('redis unavailable')
    }

    await expect(breaker.execute(failure)).rejects.toThrow('redis unavailable')
    await expect(breaker.execute(failure)).rejects.toThrow('redis unavailable')
    expect(breaker.isOpen).toBe(true)
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow('CACHE_CIRCUIT_OPEN')

    jest.advanceTimersByTime(1001)
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok')
    expect(breaker.isOpen).toBe(false)
    jest.useRealTimers()
  })
})
