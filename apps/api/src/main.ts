import './telemetry'
import { ConsoleLogger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { telemetry } from './telemetry'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: new ConsoleLogger({
      json: true,
      colors: false,
      prefix: process.env.INSTANCE_ID ?? 'cache-api',
      timestamp: true,
    }),
  })
  app.use(helmet())
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.setGlobalPrefix('api')
  app.enableShutdownHooks()

  const swagger = new DocumentBuilder()
    .setTitle('Distributed Cache Lab API')
    .setDescription('Real Redis/PostgreSQL cache experiments and lab controls')
    .setVersion('1.0')
    .build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger))

  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')
}

void bootstrap()

process.once('SIGTERM', () => {
  void telemetry.shutdown()
})
