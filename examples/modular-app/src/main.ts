/**
 * Вход процесса, один на все роли развёртывания.
 *
 * `APP_FEATURES=users` и `APP_FEATURES=notifications` поднимают две
 * половины приложения в разных процессах, `APP_FEATURES=all` — обе одним
 * процессом. Код фич во всех трёх запусках один и тот же.
 */

import { app } from './app.js';
import { Mail } from './switches.js';

import { from, load, makeConfig } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * Секция корня: аргумент сборки читается до контейнера.
 *
 * Префикс `root` отличает её от секций фич и пакетов, ключ выбора фич
 * задан точно (`APP_FEATURES`), а значения переключателя описаны его
 * схемой.
 */
const RootConfig = makeConfig('root', {
  features: from('APP_FEATURES', z.string().default('all')),
  mail: from('APP_MAIL', Mail.schema),
});

const cfg = load(RootConfig);

/**
 * `includeDeps: true` добирает фичи, чьи операции вызывает выбранная:
 * `APP_FEATURES=users` поднимает и владельца `notifications.check-address`,
 * когда шины рядом нет.
 */
await app.build({ ...cfg, includeDeps: true }).run();
