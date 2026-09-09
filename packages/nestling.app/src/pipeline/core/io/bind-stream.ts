/**
 * Рантайм потоковых форм: поэлементная валидация, item-цепочка, счётчики
 * и обёртка завершения.
 *
 * Живёт в ядре, а не в транспортах: форма io — kernel-понятие, и цепочка
 * обязана работать одинаково у любого транспорта. Транспорт остаётся
 * переводчиком байтов.
 */

import type { Schema } from '@common/misc';
import { SchemaValidationError, validateSync } from '@common/misc';
import type {
  ChainStep,
  FormDescriptor,
  FormLeaf,
  StreamSummary,
} from '@nestling/operations';
import {
  BadRequest,
  batch,
  filter,
  gapTimeout,
  isPrimitiveLeaf,
  limit,
  PayloadTooLarge,
  tap,
  throttle,
  Timeout,
  untilAborted,
} from '@nestling/operations';

/** Что рантайму нужно от контекста запроса, чтобы обернуть поток */
export interface StreamBindContext {
  readonly signal: AbortSignal;
  readonly summary: StreamSummary;
}

/** Значение — асинхронно итерируемое */
export function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in (value as object)
  );
}

/**
 * Навешивает шаги цепочки в порядке объявления.
 *
 * `limit`/`gapTimeout` отказывают **kernel-отказами**: иначе проверка
 * границы потока превращала бы штатный отказ лимита в `500 internal_error`.
 */
function applyChain(
  source: AsyncIterable<unknown>,
  chain: readonly ChainStep[],
): AsyncIterable<unknown> {
  let current = source;

  for (const step of chain) {
    switch (step.op) {
      case 'tap': {
        current = tap(current, step.fn);
        break;
      }
      case 'filter': {
        current = filter(current, step.fn);
        break;
      }
      case 'limit': {
        current = limit(current, step.max, (max) =>
          PayloadTooLarge({ limit: max }),
        );
        break;
      }
      case 'gapTimeout': {
        current = gapTimeout(current, step.ms, () => Timeout());
        break;
      }
      case 'throttle': {
        current = throttle(current, step.perSecond);
        break;
      }
      case 'batch': {
        current = batch(current, step.size);
        break;
      }
      default: {
        current = step.fn(current);
      }
    }
  }

  return current;
}

/**
 * Поэлементная валидация схемой-листом — та же синхронная реализация, что
 * у значений: второй кодовой ветки валидации в ядре нет.
 *
 * `onInvalid: 'skip'` действует только на входе; на выходе невалидный
 * элемент — всегда отказ, молчаливая потеря данных из ответа не
 * поддерживается.
 */
async function* validateItems(
  source: AsyncIterable<unknown>,
  leaf: FormLeaf,
  skipInvalid: boolean,
): AsyncIterableIterator<unknown> {
  for await (const item of source) {
    let value: unknown;

    try {
      value = validateSync(
        leaf as Schema,
        item,
        'Stream item validation failed',
      );
    } catch (error) {
      if (!(error instanceof SchemaValidationError)) {
        throw error;
      }
      if (skipInvalid) {
        continue;
      }
      throw BadRequest(error.issues, { cause: error });
    }

    yield value;
  }
}

async function* countItems(
  source: AsyncIterable<unknown>,
  summary: StreamSummary,
  field: 'itemsIn' | 'itemsOut',
): AsyncIterableIterator<unknown> {
  for await (const item of source) {
    summary[field] += 1;
    yield item;
  }
}

/** Нужна ли валидация: примитивный лист описывает байты, а не значение */
function validatable(form: FormDescriptor): boolean {
  return (
    form.items?.validate === true &&
    form.leaf !== undefined &&
    !isPrimitiveLeaf(form.leaf)
  );
}

/**
 * Обёртка входного потока: валидация до цепочки (схема описывает
 * сериализованную форму), затем шаги цепочки, затем счётчик — `itemsIn`
 * считает то, что
 * действительно дошло до хендлера, поэтому `.filter` его уменьшает.
 *
 * Итерация завершается по взведению `signal`, а источник закрывается —
 * иначе оборванный запрос висел бы до GC.
 */
export function bindInputStream<T>(
  form: FormDescriptor,
  source: AsyncIterable<unknown>,
  ctx: StreamBindContext,
): AsyncIterableIterator<T> {
  let current: AsyncIterable<unknown> = untilAborted(source, ctx.signal);

  if (validatable(form)) {
    current = validateItems(
      current,
      form.leaf as FormLeaf,
      form.items?.onInvalid === 'skip',
    );
  }

  current = applyChain(current, form.chain ?? []);

  return countItems(
    current,
    ctx.summary,
    'itemsIn',
  ) as AsyncIterableIterator<T>;
}

/**
 * Обёртка выходного потока: шаги цепочки, затем валидация (цепочка
 * `T → T`, так что схема одинаково описывает сериализованную форму на
 * обоих концах), затем счётчик `itemsOut`.
 *
 * Обёртку завершения (`.finally`) навешивает пайплайн отдельно и позже —
 * она обязана быть самой внешней.
 *
 * Возвращается объект-итератор поверх собранной цепочки, а не сама цепочка.
 * Причина — закрытие до первого `next()`: звенья цепочки суть асинхронные
 * генераторы, и `return()` на неначатом генераторе его тела не исполняет,
 * поэтому до источника такое закрытие не доходит. Пока итерация не
 * началась, источник закрывает обёртка формы — она собрала цепочку, ей и
 * отвечать за то, что под ней. После первого `next()` закрытие идёт
 * обычным путём: начатые генераторы выполняют свои `finally` и закрывают
 * нижележащее звено сами.
 *
 * Инвариант, на котором это держится: неначатый генератор ресурсов не
 * держит. Он верен и для обёрток ядра, и для шагов цепочки — таймер
 * `gapTimeout`, буфер `batch` и счётчик `limit` создаются в теле итерации.
 * Того же требует от пользовательского шага `.through(fn)` дизайн
 * потоков (`docs/design/streaming.md`).
 */
export function bindOutputStream<T>(
  form: FormDescriptor,
  source: AsyncIterable<unknown>,
  ctx: StreamBindContext,
): AsyncIterableIterator<T> {
  let current = applyChain(source, form.chain ?? []);

  if (validatable(form)) {
    current = validateItems(current, form.leaf as FormLeaf, false);
  }

  const chain = countItems(
    current,
    ctx.summary,
    'itemsOut',
  ) as AsyncIterableIterator<T>;

  let started = false;

  /** Закрытие в обход неначатой цепочки — сквозь неё оно бы не прошло */
  const closeSource = async (): Promise<void> => {
    await source[Symbol.asyncIterator]().return?.();
  };

  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return this;
    },

    async next(...args): Promise<IteratorResult<T>> {
      started = true;

      return chain.next(...args);
    },

    async return(value?: unknown): Promise<IteratorResult<T>> {
      if (!started) {
        await closeSource();
      }

      return (
        (await chain.return?.(value)) ??
        ({ value, done: true } as IteratorResult<T>)
      );
    },

    async throw(error?: unknown): Promise<IteratorResult<T>> {
      if (!started) {
        await closeSource();
      }

      if (!chain.throw) {
        throw error;
      }

      return chain.throw(error);
    },
  };
}

/**
 * Обёртка завершения: выполняет `onSettled` ровно один раз — на нормальном
 * конце потока, на ошибке источника и на закрытии потребителем (`return()`
 * или `throw()`).
 *
 * Не генератор, а явный объект-итератор. Тело асинхронного генератора
 * начинает выполняться с первого `next()`, поэтому `return()` на неначатом
 * генераторе не исполнил бы ни `try`, ни `finally` — а значит, и
 * отложенные `.finally`-юниты. Объект-итератор финализирует запрос
 * независимо от того, читал ли потребитель поток. Тот же приём и по той же
 * причине применён в `Topic.subscribe`.
 *
 * Итератор источника берётся лениво: в первом `next()` либо в закрытии,
 * если оно пришло раньше. Закрытие доходит до источника и тогда, когда
 * не прочитано ни одного элемента.
 *
 * Именно закрытие итератора выполняет отложенные `.finally`-юниты, поэтому
 * операция с транспортом прост: потребить итератор до конца **либо**
 * закрыть его.
 *
 * @param onSettled - получает ошибку потока (или `undefined`) и возвращает
 * значение, которое нужно бросить вместо неё
 */
export function withFinish<T>(
  source: AsyncIterable<T>,
  onSettled: (error: unknown) => Promise<unknown> | unknown,
): AsyncIterableIterator<T> {
  let iterator: AsyncIterator<T> | undefined;
  let settled = false;

  const iterate = (): AsyncIterator<T> =>
    (iterator ??= source[Symbol.asyncIterator]());

  /** Финализация ровно один раз; отдаёт замену ошибки от `onSettled` */
  const settle = async (error?: unknown): Promise<unknown> => {
    if (settled) {
      return undefined;
    }
    settled = true;

    return onSettled(error);
  };

  const finished = (value?: unknown): IteratorResult<T> =>
    ({ value, done: true }) as IteratorResult<T>;

  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return this;
    },

    async next(...args): Promise<IteratorResult<T>> {
      if (settled) {
        return finished();
      }

      let result: IteratorResult<T>;

      try {
        result = await iterate().next(...args);
      } catch (error) {
        const replacement = await settle(error);
        throw replacement === undefined ? error : replacement;
      }

      if (result.done) {
        await settle();
      }

      return result;
    },

    async return(value?: unknown): Promise<IteratorResult<T>> {
      if (settled) {
        return finished(value);
      }

      // Источник закрывается до финализации: `.finally`-юниты видят
      // освобождённые им ресурсы и итоговый `itemsOut`
      try {
        await iterate().return?.();
      } finally {
        await settle();
      }

      return finished(value);
    },

    async throw(error?: unknown): Promise<IteratorResult<T>> {
      if (settled) {
        throw error;
      }

      let result: IteratorResult<T>;

      try {
        const current = iterate();
        // Источник может обработать бросок сам — тогда поток продолжается.
        // Источника без `throw` закрытие завершает, а ошибка идёт наружу
        if (!current.throw) {
          await current.return?.();
          throw error;
        }
        result = await current.throw(error);
      } catch (error_) {
        const replacement = await settle(error_);
        throw replacement === undefined ? error_ : replacement;
      }

      if (result.done) {
        await settle();
      }

      return result;
    },
  };
}
