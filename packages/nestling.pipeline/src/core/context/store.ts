/**
 * Ячейка запроса и её хранилище на `AsyncLocalStorage`.
 *
 * Ячейку пишет только рантайм пайплайна: открывает область и отмечает
 * фазу. Накопленный `input` — тот же объект, в который pre-юниты
 * дописывают поля, поэтому обновлять ссылку после юнита не нужно.
 * Публичного сеттера пакет не экспортирует.
 *
 * Хранилище — состояние модуля `@nestling/pipeline`, как реестры семейств
 * в `@nestling/container`. Две копии пакета в `node_modules` дадут два
 * хранилища, и чтение из чужого вернёт `undefined`: копия пакета должна
 * быть одна.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { AnyInput } from '@nestling/operations';

/**
 * Фаза выполнения запроса. Нужна только для текста ошибки `get()`: по ней
 * ридер отличает «переменную ещё не положили» от «`.pre`-юниты до неё не
 * дошли».
 */
export type ContextPhase =
  | 'pre'
  | 'handler'
  | 'response'
  | 'finally'
  | 'stream';

/** Ячейка запроса: накопленный `input`, сигнал отмены и фаза */
export interface RequestCell {
  /** Ссылка на накопленный `input` пайплайна */
  input: AnyInput;

  /** Сигнал отмены запроса */
  readonly signal: AbortSignal;

  /** Текущая фаза исполнения */
  phase: ContextPhase;
}

const store = new AsyncLocalStorage<RequestCell>();

/** Ячейка текущего запроса или `undefined` вне запроса */
export const currentCell = (): RequestCell | undefined => store.getStore();

/**
 * Создаёт ячейку запроса.
 *
 * @param signal - Сигнал отмены запроса
 * @param input - Стартовый накопленный input
 */
export const makeCell = (
  signal: AbortSignal,
  input: AnyInput = {},
  phase: ContextPhase = 'pre',
): RequestCell => ({ input, signal, phase });

/**
 * Выполняет `fn` с ячейкой `cell` в качестве текущей. Вложенный вызов
 * перекрывает внешнюю ячейку на время своего выполнения, как
 * `AsyncLocalStorage.run`.
 */
export const runInScope = <R>(cell: RequestCell, fn: () => R): R =>
  store.run(cell, fn);

/** Отмечает переход к фазе `phase` */
export const setPhase = (cell: RequestCell, phase: ContextPhase): void => {
  cell.phase = phase;
};

/**
 * Оборачивает итератор так, что каждый его шаг и завершение выполняются с
 * ячейкой `cell`.
 *
 * Без обёртки `Ctx` не работал бы в ленивых генераторах: пайплайн
 * возвращает итератор раньше, чем транспорт начнёт его читать, и тело
 * генератора выполнялось бы уже вне области ячейки.
 */
export function iterateInScope<T>(
  cell: RequestCell,
  source: AsyncIterable<T>,
): AsyncIterableIterator<T> {
  const iterator = source[Symbol.asyncIterator]();

  return {
    [Symbol.asyncIterator]() {
      return this;
    },

    next: (...args) => runInScope(cell, () => iterator.next(...args)),

    return: (value?: unknown) =>
      runInScope(cell, () =>
        iterator.return
          ? iterator.return(value)
          : Promise.resolve({ done: true, value } as IteratorResult<T>),
      ),

    throw: (error?: unknown) =>
      runInScope(cell, () =>
        iterator.throw ? iterator.throw(error) : Promise.reject(error),
      ),
  };
}

/**
 * Открывает область ячейки вокруг выполнения endpoint'а без пайплайна.
 *
 * Ячейка при этом пуста: `peek()` возвращает `undefined`, а не ошибку
 * «контекста нет», поэтому поведение сервиса не зависит от того, есть ли
 * у endpoint'а пайплайн. `Ctx(Signal)` работает одинаково в обоих случаях.
 *
 * @internal Единственный потребитель — прямой путь в `@nestling/transport`
 */
export const runInRequestScope = <R>(signal: AbortSignal, fn: () => R): R =>
  runInScope(makeCell(signal, {}, 'handler'), fn);
