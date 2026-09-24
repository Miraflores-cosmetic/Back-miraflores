import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { json, raw, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

function backendRootDir(): string {
  const cwd = process.cwd().replace(/\/+$/, '');
  return cwd.endsWith('/backend') ? cwd : join(cwd, 'backend');
}

async function bootstrap() {
  // bodyParser: false — сами ставим raw для 1С-обмена, json для остального
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);

  // CommerceML file upload (Битрикс-протокол): сырое тело
  app.use(
    '/api/v1/1c/exchange',
    raw({ type: '*/*', limit: '50mb' }),
  );
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  // За reverse-proxy (nginx): req.ip / Throttler видят реальный клиент из X-Forwarded-For.
  const trustProxy = config.get<string>('TRUST_PROXY')?.trim();
  if (trustProxy === '0' || trustProxy === 'false' || trustProxy === 'off') {
    app.set('trust proxy', false);
  } else if (trustProxy && /^\d+$/.test(trustProxy)) {
    app.set('trust proxy', Number(trustProxy));
  } else {
    app.set('trust proxy', 1);
  }

  const localDir =
    config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
    join(backendRootDir(), '.data', 'local-uploads');
  mkdirSync(localDir, { recursive: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path ?? '';
    if (path.startsWith('/uploads/chat')) {
      res.status(404).end();
      return;
    }
    next();
  });
  /** Файлы с диска: http://host:3001/uploads/... (не под /api/v1; chat/ — только signed API) */
  app.useStaticAssets(localDir, { prefix: '/uploads/' });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST?.trim() || '0.0.0.0';
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`miraflores-api listening on http://${host}:${port}/api/v1`);
  // eslint-disable-next-line no-console
  console.log(`local uploads: ${localDir} → /uploads/`);
}

bootstrap();
