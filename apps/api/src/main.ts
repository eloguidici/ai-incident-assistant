import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, type Express } from 'express';
import { AppModule } from './app.module';
import { correlationMiddleware, csrfMiddleware } from './common/http';
import { getConfigToken } from './config';
import { ConfigValidationError } from './config/core';
import { appConfig, type AppConfig } from './config/slices';
import { setupOpenApi } from './openapi/setup-openapi';

/**
 * Builds the HTTP application. Configuration is loaded by the config module before providers start.
 * @throws ConfigValidationError when the environment does not match the slices.
 */
export async function createApplication() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
  });
  const settings = app.get<AppConfig>(getConfigToken(appConfig));
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  if (settings.trustProxy) expressApp.set('trust proxy', 1);
  app.use(correlationMiddleware);
  app.use(cookieParser());
  app.use(json({ limit: '32kb' }));
  app.use(csrfMiddleware);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: settings.webOrigin, credentials: true });
  return app;
}

/** Starts the API on the port from the app slice. */
export async function bootstrap(): Promise<void> {
  const app = await createApplication();
  setupOpenApi(app);
  const settings = app.get<AppConfig>(getConfigToken(appConfig));
  await app.listen(settings.port);
  console.log(JSON.stringify({ level: 'info', msg: 'api_listening', port: settings.port }));
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
    } else {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : 'unknown';
      console.error(`The API could not start. code=${code}`);
    }
    process.exit(1);
  });
}
