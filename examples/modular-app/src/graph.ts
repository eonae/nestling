/* eslint-disable no-console -- скрипт печатает путь выгруженного графа */
/**
 * Выгрузка графа зависимостей для `@nestlingjs/viz`.
 *
 * Граф читается у собранного контейнера: `wireApp` проводит приложение по
 * фазам до WIRE и отдаёт контейнер, а `toJSON()` переводит его в файл,
 * который открывает визуализатор.
 *
 * Шов `@nestlingjs/app/testing` виден только под условием экспорта
 * `testing`, поэтому скрипт запускается с `--conditions=testing`. Оттуда
 * же приезжает двойник брокера: ради графа поднимать NATS незачем.
 * Выгрузка графа — работа времени разработки, и отдельной боевой двери к
 * контейнеру у приложения нет.
 *
 * Базе двойника не нашлось: пул открывается на фазе INIT, а граф известен
 * только после неё. Перед выгрузкой поднимите инфраструктуру —
 * `yarn db:up`.
 *
 * Запуск: `yarn workspace @examples/modular-app visualize` — выгрузка и
 * открытие браузера; `… graph users` — граф процесса одной фичи.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareApp } from './app.js';

import { wireApp } from '@nestlingjs/app/testing';
import { NatsDouble, natsDouble } from '@nestlingjs/transport.nats/testing';

/** Аргумент сборки — аргумент командной строки; без него выбраны все фичи */
const args = process.argv[2] ?? 'all';

// Порт `0` — эфемерный: скрипт не занимает порт боевого процесса. База и
// брокер тоже ненастоящие: граф известен до первого запроса
const wired = await wireApp(
  declareApp({
    httpPort: 0,
    databaseUrl:
      process.env.DATABASE_URL ??
      'postgresql://modular:modular@localhost:5433/modular',
    nats: { connect: natsDouble(new NatsDouble()) },
  }),
  { args },
);

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'di-metadata.json',
);

writeFileSync(
  file,
  `${JSON.stringify(await wired.container.toJSON(), undefined, 2)}\n`,
);

await wired.close();

console.log(`${file}: граф сборки '${args}'`);
