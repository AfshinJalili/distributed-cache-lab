import type { InstanceHealth } from '@dcl/contracts'
import type { LabStateStore } from '@dcl/platform'

export class HeartbeatPublisher {
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly labState: LabStateStore,
    private readonly instanceId: string,
  ) {}

  async start(): Promise<void> {
    if (this.timer) return
    await this.publish()
    this.timer = setInterval(() => void this.publish(), 5000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private async publish(): Promise<void> {
    const instance: InstanceHealth = {
      id: this.instanceId,
      role: 'worker',
      lastSeenAt: Date.now(),
    }
    await this.labState.heartbeat(instance).catch(() => undefined)
  }
}
