import { appConfigKeys } from '../../src/app.config.js';
import { app } from '../../src/app.js';

import type { AssembledApp } from '@nestling/app';
import { makeApp } from '@nestling/app';
import { objectSource } from '@nestling/config';
import { transportValue } from '@nestling/transport';
import { HttpTransport, HttpTransport$ } from '@nestling/transport.http';

/** Токен, который e2e-тесты передают в заголовке `authorization` */
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
 * Транспорт создаётся руками и регистрируется значением: тесту нужен
 * фактический адрес, а порт `0` отдаёт его только после `serve()`.
 * Секреты привязываются источником к ключам секции, `process.env` не
 * трогается.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const transport = new HttpTransport({ port: 0, host: '127.0.0.1' });

  // Та же декларация, что в `app.ts`, с транспортом на порту `0` и
  // секретами из объекта: состав берётся из `app.spec`
  const assembled = makeApp({
    features: app.spec.features,
    plugins: app.spec.plugins,
    policies: app.spec.policies,
    transports: [transportValue(HttpTransport$('default'), transport)],
    config: [
      [
        objectSource(
          { API_TOKEN: E2E_TOKEN, WEBHOOK_SECRET: E2E_WEBHOOK_SECRET },
          'e2e',
        ),
        appConfigKeys,
      ],
    ],
  }).assemble();

  await assembled.run();

  const address = transport.address();
  if (!address) {
    throw new Error('transport did not report an address after serve()');
  }

  return { app: assembled, baseUrl: `http://127.0.0.1:${address.port}` };
}

export async function closeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
}
