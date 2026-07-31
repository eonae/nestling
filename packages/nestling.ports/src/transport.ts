/**
 * Токен транспорта шины и его биндинг.
 *
 * Биндинг — транспорт-специфичное значение декларации, ровно как bind-карта
 * у HTTP: ядро переносит его на декларацию и в проекцию маршрута, но никогда
 * не интерпретирует. Читают его только шина (кому какой subject слушать) и
 * топология портов (кто чей владелец).
 */

import type { ContractKind } from './contract.js';

import { makeToken } from '@nestling/container';
import { transportNameOf } from '@nestling/pipeline';
import type { TransportToken } from '@nestling/transport';

/**
 * Токен транспорта шины.
 *
 * Им ссылается на транспорт каждая декларация `implement(...)`; по нему же
 * `App` берёт инстанс из графа — «реализация требует шину, которой нет» это
 * та же незарегистрированная зависимость, что и любая другая.
 */
export const BusTransport$: TransportToken = makeToken('transport:bus');

/** Короткое имя транспорта (`'bus'`) — то же, что читают слои пайплайна */
export const BUS_TRANSPORT_NAME = transportNameOf(BusTransport$);

/** Бренд биндинга: случайный объект с полем `subject` биндингом не считается */
const BUS_BINDING = Symbol.for('nestling:bus-binding');

/**
 * Биндинг декларации-реализации: адрес на шине и вид доставки.
 *
 * Адрес в процессе (`pattern`) и адрес на шине (`subject`) разведены:
 * у события подписчиков много, и уникальность паттерна внутри транспорта
 * держится суффиксом `@<subscriber>`.
 */
export interface BusBinding {
  /** Subject шины — имя контракта, одинаковое у всех подписчиков */
  readonly subject: string;

  /** Вид контракта: определяет семантику доставки */
  readonly kind: ContractKind;

  /** Имя подписчика — есть только у `event`; оно же имя группы доставки */
  readonly subscriber?: string;
}

/** Строит биндинг реализации, ставя бренд неперечислимым свойством */
export function makeBusBinding(binding: BusBinding): BusBinding {
  const value: Record<string, unknown> = {
    subject: binding.subject,
    kind: binding.kind,
  };

  if (binding.subscriber !== undefined) {
    value.subscriber = binding.subscriber;
  }

  Object.defineProperty(value, BUS_BINDING, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(value) as unknown as BusBinding;
}

/** Значение — биндинг, положенный этим транспортом */
export function isBusBinding(value: unknown): value is BusBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[BUS_BINDING] === true
  );
}

/** Носитель биндинга: и декларация, и проекция маршрута */
export interface BusBindingBearer {
  readonly binding?: unknown;
}

/**
 * Читает биндинг с декларации или проекции маршрута.
 *
 * `undefined` означает «эта декларация не про шину»: у ручки чужого
 * транспорта биндинг чужой, и путать их нельзя.
 */
export function busBindingOf(bearer: BusBindingBearer): BusBinding | undefined {
  return isBusBinding(bearer.binding) ? bearer.binding : undefined;
}
