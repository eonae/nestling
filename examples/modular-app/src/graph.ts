/**
 * Выгрузка графа зависимостей для `@nestlingjs/viz`.
 *
 * Граф читается у собранного контейнера: `wireApp` проводит приложение по
 * фазам до WIRE и отдаёт контейнер, а `toJSON()` переводит его в файл,
 * который открывает визуализатор.
 *
 * Шов `@nestlingjs/app/testing` виден только под условием экспорта
 * `testing`, поэтому скрипт запускается с `--conditions=testing`. Оттуда
 * же берётся двойник брокера: ради графа поднимать NATS незачем.
 * Выгрузка графа — работа времени разработки, и отдельной боевой двери к
 * контейнеру у приложения нет.
 *
 * Базе двойника не нашлось: пул открывается на фазе INIT, а граф известен
 * только после неё. Перед выгрузкой поднимите инфраструктуру —
 * `yarn db:up`.
 *
 * Запуск: `yarn workspace @examples/modular-app visualize` — выгрузка и
 * открытие браузера; `… graph --features users` — граф процесса одной
 * фичи.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareApp } from './app.js';
import { ephemeralHttp } from './testing.js';

import { argv, bind, makeConsoleLogger } from '@nestlingjs/app';
import { wireApp } from '@nestlingjs/app/testing';
import { vars } from '@nestlingjs/testing';
import { NatsDouble, natsDouble } from '@nestlingjs/transport.nats/testing';

/** Аргумент сборки — командная строка скрипта; без флагов выбраны все фичи */
const args = argv(process.argv);

// Порт `0` — эфемерный: скрипт не занимает порт боевого процесса. База и
// брокер тоже ненастоящие: граф известен до первого запроса
const wired = await wireApp(
  declareApp({
    nats: { connect: natsDouble(new NatsDouble()) },
  }),
  {
    args,
    config: [
      ephemeralHttp(),
      bind(
        vars({
          DATABASE_URL:
            // eslint-disable-next-line @nestlingjs/no-process-globals -- скрипт печати графа: адрес базы подставляется прямо в тестовый источник
            process.env.DATABASE_URL ??
            'postgresql://modular:modular@localhost:5433/modular',
        }),
      ),
    ],
  },
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

makeConsoleLogger().info('graph written', { file, args: args.strings });
