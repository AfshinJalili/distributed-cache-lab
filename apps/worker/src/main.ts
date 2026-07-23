import './telemetry'
import { ConsoleLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { telemetry } from './telemetry'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new ConsoleLogger({
      json: true,
      colors: false,
      prefix: process.env.INSTANCE_ID ?? 'cache-worker',
      timestamp: true,
    }),
  })
  app.enableShutdownHooks()
}

void bootstrap()

process.once('SIGTERM', () => {
  void telemetry.shutdown()
})
