/**
 * Типовые тесты карт узлов транспортного слоя у собранного приложения.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { makeApp } from './app.js';

const app = makeApp({}).assemble();

/** Чтение — единственное, что даёт карта транспортов */
const transport = app.transports.get('default');
const names = [...app.transports.keys()];

/** Записи нет: добавить экземпляр в граф через карту нельзя */
// @ts-expect-error карта транспортов только на чтение
app.transports.set('default', transport);

/** У карты серверов та же поверхность */
// @ts-expect-error карта серверов только на чтение
app.servers.delete('default');
