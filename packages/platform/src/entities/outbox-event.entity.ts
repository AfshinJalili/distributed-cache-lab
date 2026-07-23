import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { ResourceKey, WritePolicy } from '@dcl/contracts'

export type OutboxStatus = 'pending' | 'processing' | 'completed'

@Entity({ name: 'cache_outbox' })
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ name: 'resource_key', type: 'varchar', length: 80 })
  resourceKey!: ResourceKey

  @Column({ name: 'write_policy', type: 'varchar', length: 30 })
  writePolicy!: WritePolicy

  @Column({ type: 'integer' })
  version!: number

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: OutboxStatus

  @Column({ type: 'integer', default: 0 })
  attempts!: number

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  nextAttemptAt!: Date

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
