import { appConfigKeys } from '../../src/app.config.js';
import { app } from '../../src/app.js';

import type { AssembledApp } from '@nestling/app';
import { makeApp, objectSource } from '@nestling/app';
import type { HttpServer } from '@nestling/transport.http';
import { http, httpServer, httpServerKeys } from '@nestling/transport.http';

/** Bearer-токен, который e2e-тесты передают в заголовке `authorization` */
export const E2E_TOKEN = 'e2e-token';

/** Секрет, которым e2e-тесты подписывают webhook */
export const E2E_WEBHOOK_SECRET = 'e2e-hook';

export interface TestAppContext {
  app: AssembledApp;
  baseUrl: string;
}

/**
 * Поднимает приложение на эфемерном порту.
 *
 * Порт задаётся ключом `HTTP_PORT=0` из объекта-источника: сокетом владеет
 * сервер, а фактический адрес известен только после `listen`. Секреты
 * привязываются тем же способом, `process.env` не трогается.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const api = httpServer();

  // Та же декларация, что в `app.ts`, с эфемерным портом и секретами из
  // объекта: состав берётся из `app.spec`
  const assembled = makeApp({
    features: app.spec.features,
    plugins: app.spec.plugins,
    switches: app.spec.switches,
    policies: app.spec.policies,
    transports: [api, http({ server: api })],
    config: [
      [
        objectSource(
          { API_TOKEN: E2E_TOKEN, WEBHOOK_SECRET: E2E_WEBHOOK_SECRET },
          'e2e',
        ),
        appConfigKeys,
      ],
      [
        objectSource({ HTTP_PORT: '0', HTTP_HOST: '127.0.0.1' }, 'e2e-http'),
        httpServerKeys(),
      ],
    ],
  }).assemble();

  await assembled.run();

  const server = assembled.servers.get(api.name) as HttpServer | undefined;
  const address = server?.address();
  if (!address) {
    throw new Error('server did not report an address after listen()');
  }

  return { app: assembled, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function closeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
}
