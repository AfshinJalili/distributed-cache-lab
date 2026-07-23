import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import {
  OutboxEventEntity,
  ResourceEntity,
  databaseOptions,
} from '@dcl/platform'
import { BootstrapService } from './bootstrap.service'
import { EventsController } from './events.controller'
import { HealthController } from './health.controller'
import { InfrastructureModule } from './infrastructure.module'
import { LabController } from './lab.controller'
import { LabService } from './lab.service'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { ResourceCacheService } from './resource-cache.service'
import { ResourcesController } from './resources.controller'
import { ResourcesService } from './resources.service'
import { ToxiproxyService } from './toxiproxy.service'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseOptions()),
    TypeOrmModule.forFeature([ResourceEntity, OutboxEventEntity]),
    InfrastructureModule,
  ],
  controllers: [
    ResourcesController,
    LabController,
    EventsController,
    MetricsController,
    HealthController,
  ],
  providers: [
    MetricsService,
    ResourceCacheService,
    ResourcesService,
    LabService,
    ToxiproxyService,
    BootstrapService,
  ],
})
export class AppModule {}
