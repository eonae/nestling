/**
 * Вход процесса, один на все роли развёртывания.
 *
 * `APP_FEATURES=users` и `APP_FEATURES=quotas` поднимают две половины
 * приложения в разных процессах, `APP_FEATURES=all` — обе одним
 * процессом. Код фич во всех трёх запусках один и тот же.
 */

import { app } from './app';

import { load, makeConfig } from '@nestling/config';
import { z } from 'zod';

/** Секция корня: выбор фич читается до сборки контейнера */
const RootConfig = makeConfig('app', {
  features: z.string().default('all'),
});

const cfg = load(RootConfig);

await app.assemble(cfg.features).run();
