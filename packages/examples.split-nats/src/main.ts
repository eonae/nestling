/**
 * Вход процесса — один на все роли развёртывания.
 *
 * `APP_FEATURES=orders` и `APP_FEATURES=quotas` поднимают две половины
 * распределённой системы; `APP_FEATURES=all` — их же одним процессом.
 * Между этими тремя запусками не меняется ни строки кода фич.
 */

import { makeRoot } from './root';

import { load, makeConfig } from '@nestling/config';
import { z } from 'zod';

/** Секция корня: единственное пред-сборочное чтение конфига */
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),
});

async function main(): Promise<void> {
  // Фаза 0: выбор фич считается до построения контейнера
  const cfg = load(RootConfig);

  await makeRoot(cfg.features).run();
}

void main();
