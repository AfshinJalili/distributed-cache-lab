import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { resourceKeys, type ResourceKey } from '@dcl/contracts'
import { ResourceCacheService } from './resource-cache.service'
import { ResourcesService } from './resources.service'

function parseKey(value: string): ResourceKey {
  const decoded = decodeURIComponent(value)
  if (!resourceKeys.includes(decoded as ResourceKey)) {
    throw new UnprocessableEntityException(`Unknown lab resource key: ${decoded}`)
  }
  return decoded as ResourceKey
}

@ApiTags('resources')
@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly cache: ResourceCacheService,
    private readonly resources: ResourcesService,
  ) {}

  @Get(':key')
  @ApiOperation({ summary: 'Read a resource through the distributed cache' })
  @ApiParam({ name: 'key', example: 'product:42' })
  async read(
    @Param('key') rawKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const key = parseKey(rawKey)
    const outcome = await this.cache.read(key)
    const cache = outcome.response.cache
    response.status(outcome.statusCode)
    response.setHeader(
      'Cache-Status',
      cache.result === 'HIT' || cache.result === 'NEGATIVE_HIT'
        ? `dcl; hit; ttl=${cache.ttlSeconds}`
        : cache.result === 'STALE'
          ? 'dcl; hit; fwd=stale'
          : cache.result === 'BYPASS'
            ? 'dcl; fwd=bypass'
            : 'dcl; fwd=uri-miss; stored',
    )
    response.setHeader('Age', String(cache.ageSeconds))
    response.setHeader('X-Cache-Result', cache.result)
    response.setHeader('X-Instance-Id', cache.instanceId)
    response.setHeader('Server-Timing', `cache;dur=${outcome.trace.latencyMs}`)
    if (outcome.response.resource) {
      response.setHeader(
        'ETag',
        `"${outcome.response.resource.key}-v${outcome.response.resource.version}"`,
      )
    }
    return outcome.response
  }

  @Post(':key/write')
  @HttpCode(202)
  @ApiOperation({ summary: 'Mutate an origin resource and enqueue cache reconciliation' })
  write(@Param('key') rawKey: string) {
    return this.resources.write(parseKey(rawKey))
  }
}
