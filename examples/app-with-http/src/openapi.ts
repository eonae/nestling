/* eslint-disable no-console -- скрипт печатает путь и состав документа */
/**
 * Документ OpenAPI для CI: фаза 0 декларации плюс чистая функция.
 *
 * Приложение не поднимается: `app.discover(args)` разбирает аргумент
 * сборки, раскрывает ветки переключателей и разрешает выбор фич, не
 * читая источников конфига и не строя графа. Поэтому документ описывает
 * ровно тот состав, которым процесс и поднимется с тем же аргументом.
 *
 * Запуск: `yarn workspace @examples/app-with-http openapi` — все фичи и
 * `docs=on`; `… openapi users` — только фича пользователей.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, openapiOptions } from './app.js';

import { buildOpenApiDocument } from '@nestlingjs/openapi';

/** Аргумент сборки — аргумент командной строки; без него выбраны все фичи */
const args = process.argv[2];

const { endpoints } = app.discover(args);

const document = buildOpenApiDocument(endpoints, openapiOptions);

const file = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'openapi.json',
);

writeFileSync(file, `${JSON.stringify(document, undefined, 2)}\n`);

console.log(`${file}: ${Object.keys(document.paths).length} path(s)`);
