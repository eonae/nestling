/**
 * Типовые тесты объявления транспорта: природа шины обязательна.
 *
 * Файл не гоняется vitest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type {
  FormKind,
  TransportCapabilities,
  TransportRef,
} from '../pipeline/index.js';

import { transportValue } from './declaration.js';
import type { ITransport } from './interfaces.js';

import { makeToken } from '@nestlingjs/container';

const Bus$ = makeToken<ITransport>('transport:bus') as TransportRef;

const instance = {} as ITransport;

const BUS_CAPABILITIES: TransportCapabilities = {
  input: new Set<FormKind>(['value']),
  output: new Set<FormKind>(['value']),
};

/** Обычный транспорт про природу шины не пишет: поля у него нет */
const plain = transportValue(Bus$, instance, {
  capabilities: BUS_CAPABILITIES,
});

/** Переносчик операций объявляет, доставляет ли он наружу */
const bus = transportValue(Bus$, instance, {
  bus: true,
  remote: true,
  capabilities: BUS_CAPABILITIES,
});

const remote: boolean = bus.remote;

/** Без признака объявление шины не компилируется */
// @ts-expect-error у объявления шины поле `remote` обязательное
transportValue(Bus$, instance, { bus: true, capabilities: BUS_CAPABILITIES });
