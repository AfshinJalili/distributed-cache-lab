import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator'
import type { CacheSettings, EvictionPolicy, WritePolicy } from '@dcl/contracts'

export class PatchSettingsDto implements Partial<CacheSettings> {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(90)
  ttlSeconds?: number

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  staleWindowSeconds?: number

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  negativeTtlSeconds?: number

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(6)
  capacity?: number

  @IsOptional()
  @IsIn(['LRU', 'LFU'])
  eviction?: EvictionPolicy

  @IsOptional()
  @IsBoolean()
  coalescing?: boolean

  @IsOptional()
  @IsBoolean()
  staleWhileRevalidate?: boolean

  @IsOptional()
  @IsBoolean()
  ttlJitter?: boolean

  @IsOptional()
  @IsIn(['invalidate', 'write-through'])
  writePolicy?: WritePolicy
}

export class AdvanceClockDto {
  @IsInt()
  @Min(1)
  @Max(300)
  @Transform(({ value }) => Number(value))
  seconds!: number
}

export class SetFaultDto {
  @IsBoolean()
  enabled!: boolean
}
