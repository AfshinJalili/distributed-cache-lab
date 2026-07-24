import type { ResourceView } from '@dcl/contracts'
import type { ResourceEntity } from './entities/resource.entity'

export function toResourceView(entity: ResourceEntity): ResourceView {
  return {
    key: entity.key,
    version: entity.version,
    document: entity.document,
    updatedAt: entity.updatedAt.toISOString(),
  }
}
