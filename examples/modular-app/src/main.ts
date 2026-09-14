/**
 * Вход процесса, один на все роли развёртывания.
 *
 * `--features users` и `--features notifications` поднимают две половины
 * приложения в разных процессах, `--features all` — обе одним процессом.
 * Код фич во всех трёх запусках один и тот же. `--help` печатает схему:
 * фичи, флаги и значения переключателей.
 */

import { app } from './app.js';

import { argv } from '@nestlingjs/app';

await app.build(argv(process.argv)).run();
