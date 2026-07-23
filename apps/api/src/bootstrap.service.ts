import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import type { InstanceHealth } from '@dcl/contracts'
import { LabStateStore, ResourceEntity, resetSeedData } from '@dcl/platform'
import { LAB_STATE } from './tokens'

@Injectable()
export class BootstrapService implements OnApplicationBootstrap, OnApplicationShutdown {
  private interval: NodeJS.Timeout | undefined
  private readonly instance: InstanceHealth = {
    id: process.env.INSTANCE_ID ?? `api-${process.pid}`,
    role: 'api',
    lastSeenAt: Date.now(),
  }

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(LAB_STATE) private readonly labState: LabStateStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SEED_ON_START === 'true') {
      const count = await this.dataSource.getRepository(ResourceEntity).count()
      if (count === 0) await this.dataSource.transaction((manager) => resetSeedData(manager))
    }
    await this.heartbeat()
    this.interval = setInterval(() => void this.heartbeat(), 5000)
    this.interval.unref()
  }

  onApplicationShutdown(): void {
    if (this.interval) clearInterval(this.interval)
  }

  private async heartbeat(): Promise<void> {
    this.instance.lastSeenAt = Date.now()
    await this.labState.heartbeat(this.instance).catch(() => undefined)
  }
}
