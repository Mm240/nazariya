import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/** Shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: NestExpressApplication): void {
  // Render (and most hosts) sit behind a proxy: rate-limit by the real client IP.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  // JSON-only API: no CSP needed, and resources must be readable cross-origin by the web app.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: parseOrigins(process.env.CORS_ORIGINS),
    methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Visitor-Id', 'X-Admin-Token'],
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('Nazariya API')
    .setDescription(
      'Read-only API behind Nazariya: news stories clustered across English and Hindi outlets, ' +
        'with AI-written comparisons of how each outlet framed them.',
    )
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
}

/** CORS_ORIGINS="https://nazariya.vercel.app,http://localhost:5173", or unset / "*" for any origin. */
export function parseOrigins(raw: string | undefined): boolean | string[] {
  if (!raw || raw.trim() === '*') return true;
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
