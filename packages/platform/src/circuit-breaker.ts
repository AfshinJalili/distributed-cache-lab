export class CircuitBreaker {
  private failures = 0
  private openUntil = 0

  constructor(
    private readonly threshold = 2,
    private readonly resetAfterMs = 3000,
  ) {}

  get isOpen(): boolean {
    return Date.now() < this.openUntil
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new Error('CACHE_CIRCUIT_OPEN')
    try {
      const result = await operation()
      this.failures = 0
      return result
    } catch (error) {
      this.failures += 1
      if (this.failures >= this.threshold) {
        this.openUntil = Date.now() + this.resetAfterMs
        this.failures = 0
      }
      throw error
    }
  }
}
