/**
 * Типовые тесты матрицы топологий.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { checkTopologies } from './topologies.js';

import { argv, makeApp, makeFeature } from '@nestlingjs/app';
import { makeSwitch } from '@nestlingjs/container';

const Storage = makeSwitch('storage', ['s3', 'local'], { default: 's3' });

const app = makeApp({
  features: [makeFeature({ name: 'users', providers: [] })],
  switches: [Storage],
});

/** Топология — объектная форма: выбор фич и ветки вместе */
const objectForm = checkTopologies(app, [
  { features: 'all' },
  { features: 'users', storage: 'local' },
]);

/** Маркер элементом списка не принимается: матрица перечисляет топологии в коде */
const markerForm = checkTopologies(app, [
  // @ts-expect-error командная строка топологию матрицы не задаёт
  argv(process.argv),
]);

/** Перечень полей закрыт и здесь */
const typo = checkTopologies(app, [
  // @ts-expect-error поля 'storag' у аргумента сборки нет
  { storag: 'local' },
]);
