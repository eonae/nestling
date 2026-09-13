/* eslint-disable no-console -- скрипт печатает отчёт совместимости */
/* eslint-disable unicorn/no-process-exit -- это и есть CLI */
/**
 * Сверка совместимости операций: то, что делал бы CI на pull request'е.
 *
 * Скрипт собирает матрицу топологий, сводит отчёты в снимок, сравнивает
 * его с опубликованным в репозитории и печатает разницу. Ломающее
 * изменение возвращает ненулевой код выхода.
 *
 * Приложение не поднимается: `check()` разбирает аргумент сборки и строит
 * граф, не читая источников конфига и не открывая ни базы, ни брокера.
 *
 * Запуск: `yarn workspace @examples/modular-app compat`;
 * перезаписать снимок осознанно — `UPDATE_SNAPSHOT=1 … compat`.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { app } from './app.js';
import { CHECK_OPTIONS, TOPOLOGIES } from './topologies.js';

import type { OperationSnapshot } from '@nestlingjs/testing';
import {
  checkTopologies,
  diffOperations,
  formatCompatibility,
  serializeSnapshot,
  snapshotOperations,
} from '@nestlingjs/testing';

const BASELINE = new URL('../operations.snapshot.json', import.meta.url);

const current = snapshotOperations(
  await checkTopologies(app, [...TOPOLOGIES], CHECK_OPTIONS),
);

if (process.env.UPDATE_SNAPSHOT) {
  writeFileSync(BASELINE, serializeSnapshot(current));
  console.log('снимок перезаписан');
  process.exit(0);
}

const baseline = JSON.parse(
  readFileSync(BASELINE, 'utf8'),
) as OperationSnapshot;

const report = diffOperations(baseline, current);

console.log(formatCompatibility(report));

if (report.breaking.length > 0) {
  process.exitCode = 1;
}
