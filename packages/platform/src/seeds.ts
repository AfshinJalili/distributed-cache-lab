import type { DeepPartial, EntityManager } from 'typeorm'
import { ResourceEntity } from './entities/resource.entity'

export const seedResources: DeepPartial<ResourceEntity>[] = [
  {
    key: 'product:42',
    kind: 'product',
    version: 12,
    document: {
      name: 'Mechanical Keyboard 42',
      description: 'A deterministic product record used to demonstrate hot-key behavior.',
      data: {
        sku: 'KEY-0042',
        price: 12900,
        currency: 'USD',
        inventory: 84,
        tags: ['hardware', 'featured'],
      },
    },
  },
  {
    key: 'flags:global',
    kind: 'feature-flags',
    version: 8,
    document: {
      name: 'Global feature flags',
      description: 'A small, freshness-sensitive configuration document.',
      data: {
        checkoutV2: true,
        cacheLabBanner: true,
        regionalPricing: false,
      },
    },
  },
  {
    key: 'catalog:home',
    kind: 'catalog',
    version: 21,
    document: {
      name: 'Home catalog',
      description: 'A larger aggregate where cache hits avoid an expensive origin query.',
      data: {
        sections: ['trending', 'recommended', 'recently-viewed', 'deals'],
        productIds: Array.from({ length: 64 }, (_, index) => index + 1),
      },
    },
  },
  {
    key: 'pricing:pro',
    kind: 'pricing',
    version: 4,
    document: {
      name: 'Pro pricing',
      description: 'Versioned plan data used to compare write-through and invalidation.',
      data: {
        monthly: 2900,
        annual: 29000,
        currency: 'USD',
        seatsIncluded: 5,
      },
    },
  },
]

export async function resetSeedData(manager: EntityManager): Promise<void> {
  await manager.query('TRUNCATE TABLE cache_outbox, resources RESTART IDENTITY')
  await manager.getRepository(ResourceEntity).save(seedResources)
}
