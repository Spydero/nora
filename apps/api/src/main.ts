import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`Nora API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

await bootstrap();
