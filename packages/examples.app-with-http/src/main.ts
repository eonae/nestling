/* eslint-disable no-console -- точка входа печатает адрес */
import { app } from './app';

import { from, load, makeConfig } from '@nestling/config';
import { z } from 'zod';

/**
 * Секция корня: выбор фич читается до сборки контейнера.
 *
 * Префикс `root` отличает её от секции `app` в `app.config.ts`, а ключ
 * задан точно: `APP_FEATURES`.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
});

/**
 * Точка входа. `APP_FEATURES=users` поднимает фичу пользователей и те
 * фичи, чьи операции она вызывает; `APP_FEATURES=all` поднимает все.
 */
async function main(): Promise<void> {
  const cfg = load(RootConfig);

  await app.assemble({ features: cfg.features, includeDeps: true }).run();

  console.log('app-with-http: GET /health, GET /users, GET /openapi.json');
}

main().catch((error: unknown) => {
  console.error('failed to start:', error);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
});
