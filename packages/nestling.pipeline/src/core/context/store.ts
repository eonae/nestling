/**
 * Ячейка запроса и её ALS-хранилище — **машинерия проекции**.
 *
 * Единственный писатель ячейки — рантайм исполнения ручки: он открывает
 * scope, обновляет ссылку на накопленный `input` после каждого pre-юнита и
 * отмечает фазу. Публичного сеттера нет ни в одном экспорте пакета, поэтому
 * rewrite-guard не нужен by design: писать в проекцию просто нечем.
 *
 * ALS-инстанс — модульное состояние `@nestling/pipeline` (тот же приём, что
 * реестры семейств в `@nestling/container`): две копии пакета в графе
 * зависимостей дадут два хранилища, и чтение из чужого тихо вернёт
 * `undefined`. Отсюда правило «одна копия пакета — один ALS».
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { AnyInput } from '../io/io.js';

/**
 * Фаза исполнения — только для диагностики `get()`: по ней ридер
 * отличает «переменную ещё не положили» от «pre-тракт до неё не дошёл».
 */
export type ContextPhase =
  | 'pre'
  | 'handler'
  | 'response'
  | 'finally'
  | 'stream';

/** Проекция запроса: накопленный `input`, сигнал и фаза — и ничего сверх */
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
 * Исполняет `fn` под ячейкой. Вложенный вызов даёт вложенный scope:
 * внутренний перекрывает внешний на своё время жизни — штатная семантика
 * `AsyncLocalStorage.run`.
 */
export const runInScope = <R>(cell: RequestCell, fn: () => R): R =>
  store.run(cell, fn);

/** Обновление проекции после pre-юнита: ссылка на новый накопленный input */
export const updateInput = (cell: RequestCell, input: AnyInput): void => {
  cell.input = input;
};

/** Отметка перехода фазы */
export const setPhase = (cell: RequestCell, phase: ContextPhase): void => {
  cell.phase = phase;
};

/**
 * Оборачивает итератор так, что **каждый** его шаг и финализация
 * исполняются под ячейкой.
 *
 * Без этого ambient-чтение ломалось бы ровно у ленивых генераторов:
 * исполнение ручки возвращает итератор до того, как транспорт начнёт его
 * тянуть, и тело генератора работало бы уже вне scope'а.
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
 * Открывает scope запроса вокруг исполнения ручки **без пайплайна**.
 *
 * Ячейка при этом пуста: `peek()` даёт `undefined`, а не «контекста нет», —
 * поведение глубокого сервиса не зависит от того, есть у ручки пайплайн или
 * нет. `Ctx(Signal)` работает на обоих путях одинаково.
 *
 * @internal единственный потребитель — прямой путь `@nestling/transport`
 */
export const runInRequestScope = <R>(signal: AbortSignal, fn: () => R): R =>
  runInScope(makeCell(signal, {}, 'handler'), fn);
