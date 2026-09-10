import { app, Docs } from './app.js';

import { from, load, makeConfig } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Секция корня: аргумент сборки читается до контейнера.
 *
 * Префикс `root` отличает её от секции `app` в `app.config.ts`, ключ
 * выбора фич задан точно (`APP_FEATURES`), а значения переключателей
 * описаны их схемами.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
  docs: from('APP_DOCS', Docs.schema),
});

/**
 * Точка входа. `APP_FEATURES=users` поднимает фичу пользователей и те
 * фичи, чьи операции она вызывает; `APP_FEATURES=all` поднимает все.
 * `APP_DOCS=off` убирает документацию из состава.
 */
const cfg = load(RootConfig);

await app.assemble({ ...cfg, includeDeps: true }).run();
