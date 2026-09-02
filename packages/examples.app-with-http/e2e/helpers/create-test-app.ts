import { OpsFeature, UsersFeature } from '../../src/features';
import { appLogging, appSubscriptions } from '../../src/infrastructure';

import type { App } from '@nestling/app';
import { assemble } from '@nestling/app';
import { transportValue } from '@nestling/transport';
import { HttpTransport, HttpTransport$ } from '@nestling/transport.http';

export interface TestAppContext {
  app: App;
  baseUrl: string;
}

/**
 * Создаёт тестовое приложение на эфемерном порту.
 *
 * Транспорт конструируется вручную и регистрируется значением: тесту нужен
 * фактический адрес, а порт `0` отдаёт его только на фазе START —
 * `transport.address()`.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const transport = new HttpTransport({ port: 0, host: '127.0.0.1' });

  const app = assemble({
    features: [UsersFeature, OpsFeature],
    plugins: [appLogging, appSubscriptions],
    select: { features: 'users', includeDeps: true },
    transports: [transportValue(HttpTransport$('default'), transport)],
  });

  await app.run();

  const address = transport.address();
  if (!address) {
    throw new Error('transport did not report an address after serve()');
  }

  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * Закрывает тестовое приложение.
 */
export async function closeTestApp(context: TestAppContext): Promise<void> {
  if (context.app) {
    await context.app.close();
  }
}
