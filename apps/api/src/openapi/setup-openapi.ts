import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CsrfCookieName, CsrfHeaderName, SessionCookieName } from '../common/constants/http';

/**
 * Publishes OpenAPI at `/api/docs` and JSON at `/api/docs-json`.
 * Auth is cookie-based; mutating routes also require the CSRF header described in the document.
 * @param app Bootstrapped Nest application with the global `/api` prefix.
 */
export function setupOpenApi(app: INestApplication): void {
  const description = [
    'REST API for the AI Incident Assistant MVP.',
    '',
    '**Session:** `POST /auth/login` sets HttpOnly cookie `' + SessionCookieName + '` and readable cookie `' + CsrfCookieName + '`.',
    '**Protected routes:** send `' + SessionCookieName + '` on every request (browser clients do this automatically).',
    '**Mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`):** send header `' + CsrfHeaderName + '` with the same value as `' + CsrfCookieName + '`.',
    '**Correlation:** optional header `x-correlation-id` is echoed on errors.',
    '',
    'Canonical contracts also live in `docs/features/MVP.md`.',
  ].join('\n');

  const config = new DocumentBuilder()
    .setTitle('AI Incident Assistant API')
    .setDescription(description)
    .setVersion('1.0.0')
    .addCookieAuth(SessionCookieName, {
      type: 'apiKey',
      in: 'cookie',
      name: SessionCookieName,
      description: 'HttpOnly JWT session issued by `POST /auth/login`.',
    })
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: CsrfHeaderName,
        description: 'Must match the `' + CsrfCookieName + '` cookie on mutating requests.',
      },
      'csrf',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
