import { Controller, Get, Inject } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import type Redis from 'ioredis'
import { DataSource } from 'typeorm'
import { REDIS } from './tokens'

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', instanceId: process.env.INSTANCE_ID ?? `api-${process.pid}` }
  }

  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.allSettled([
      this.dataSource.query('SELECT 1'),
      this.redis.ping(),
    ])
    return {
      status: database.status === 'fulfilled' ? 'ready' : 'degraded',
      database: database.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
      instanceId: process.env.INSTANCE_ID ?? `api-${process.pid}`,
    }
  }
}
