import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Nazariya API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}

void bootstrap();
