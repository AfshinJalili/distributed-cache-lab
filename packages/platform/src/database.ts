import 'reflect-metadata'
import { DataSource, type DataSourceOptions } from 'typeorm'
import { OutboxEventEntity } from './entities/outbox-event.entity'
import { ResourceEntity } from './entities/resource.entity'
import { Init1760000000000 } from './migrations/1760000000000-init'

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 25432),
    username: process.env.POSTGRES_USER ?? 'cachelab',
    password: process.env.POSTGRES_PASSWORD ?? 'cachelab',
    database: process.env.POSTGRES_DB ?? 'cachelab',
    entities: [ResourceEntity, OutboxEventEntity],
    migrations: [Init1760000000000],
    migrationsRun: process.env.RUN_MIGRATIONS !== 'false',
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    extra: {
      max: Number(process.env.DB_POOL_SIZE ?? 12),
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    },
  }
}

export function createDataSource(): DataSource {
  return new DataSource(databaseOptions())
}
