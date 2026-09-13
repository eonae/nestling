import { app, Docs } from './app.js';

import { from, load, makeConfig } from '@nestlingjs/app';

/**
 * Секция корня: аргумент сборки читается до контейнера.
 *
 * Префикс `root` отличает её от секции `app` в `app.config.ts`, а
 * значения переключателя описаны его схемой.
 */
const RootConfig = makeConfig('root', {
  docs: from('APP_DOCS', Docs.schema),
});

/**
 * Точка входа: `build()` собирает приложение для этого процесса,
 * `run()` проводит его по фазам. Остановка по `SIGTERM` и `SIGINT`
 * устанавливается автоматически. `APP_DOCS=off` убирает документацию из
 * состава.
 */
await app.build(load(RootConfig)).run();
