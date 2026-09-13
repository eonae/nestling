/* eslint-disable no-console -- скрипт печатает путь и состав документа */
/**
 * Документ OpenAPI для CI: фаза 0 декларации плюс метод плагина.
 *
 * Приложение не поднимается: `app.discover(args)` разбирает аргумент
 * сборки и раскрывает ветки переключателей, не читая источников конфига и
 * не строя графа. Поэтому документ описывает ровно тот состав, которым
 * процесс и поднимется с тем же аргументом.
 *
 * Опции документа берутся у самого плагина, поэтому `info` записан в
 * одном месте — в декларации приложения. Документ строится и тогда, когда
 * ветка переключателя выключена: `docs=off` решает судьбу endpoint'а, а не
 * значения.
 *
 * Запуск: `yarn workspace @examples/microservice openapi` — состав по
 * умолчанию; `… openapi docs=off` — состав без документации.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, appOpenapi } from './app.js';

/** Аргумент сборки — аргумент командной строки; без него состав по умолчанию */
const args = process.argv[2];

const document = appOpenapi.document(app.discover(args));

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'openapi.json',
);

writeFileSync(file, `${JSON.stringify(document, undefined, 2)}\n`);

console.log(`${file}: ${Object.keys(document.paths).length} path(s)`);
