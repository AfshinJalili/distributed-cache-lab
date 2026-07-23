import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm'
import type { ResourceDocument, ResourceKey } from '@dcl/contracts'

@Entity({ name: 'resources' })
export class ResourceEntity {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  key!: ResourceKey

  @Column({ type: 'varchar', length: 40 })
  kind!: string

  @Column({ type: 'jsonb' })
  document!: ResourceDocument

  @Column({ type: 'integer', default: 1 })
  version!: number

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date
}
