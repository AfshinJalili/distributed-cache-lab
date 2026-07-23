import { Controller, Get, Inject, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import type Redis from 'ioredis'
import type { LabEvent } from '@dcl/contracts'
import { EventBus, keys } from '@dcl/platform'
import { EVENT_BUS, REDIS } from './tokens'

@Controller('lab/events')
export class EventsController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EVENT_BUS) private readonly events: EventBus,
  ) {}

  @Get('recent')
  recent(): Promise<LabEvent[]> {
    return this.events.recent()
  }

  @Get()
  async stream(@Req() request: Request, @Res() response: Response): Promise<void> {
    response.status(200)
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()

    const client = this.redis.duplicate({
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
    client.on('error', () => undefined)
    if (client.status === 'wait') await client.connect()

    let cursor =
      typeof request.headers['last-event-id'] === 'string'
        ? request.headers['last-event-id']
        : '$'
    let closed = false
    request.on('close', () => {
      closed = true
      client.disconnect()
    })

    response.write('retry: 1000\n\n')
    while (!closed) {
      try {
        const streams = await client.xread('COUNT', 50, 'BLOCK', 5000, 'STREAMS', keys.events, cursor)
        if (!streams) {
          response.write(': heartbeat\n\n')
          continue
        }
        for (const [, rows] of streams) {
          for (const [id, fields] of rows) {
            const dataIndex = fields.indexOf('data')
            const raw = dataIndex >= 0 ? fields[dataIndex + 1] : '{}'
            cursor = id
            response.write(`id: ${id}\nevent: cache-event\ndata: ${raw ?? '{}'}\n\n`)
          }
        }
      } catch {
        if (!closed) {
          response.write(
            `event: stream-error\ndata: ${JSON.stringify({ message: 'event stream temporarily unavailable' })}\n\n`,
          )
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }
  }
}
