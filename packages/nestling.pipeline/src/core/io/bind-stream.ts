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
} from '@nestling/contracts';
import {
  isPrimitiveLeaf,
  StreamGapTimeout,
  StreamLimitExceeded,
  ValidationFailed,
} from '@nestling/contracts';
import {
  batch,
  filter,
  gapTimeout,
  limit,
  tap,
  throttle,
  untilAborted,
} from '@nestling/streams';

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
 * `limit`/`gapTimeout` отказывают **kernel-отказами**: иначе страж границы
 * превращал бы штатный отказ лимита в `500 UNKNOWN`.
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
          StreamLimitExceeded({ max }),
        );
        break;
      }
      case 'gapTimeout': {
        current = gapTimeout(current, step.ms, (ms) =>
          StreamGapTimeout({ ms }),
        );
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
      throw ValidationFailed(error.issues, { cause: error });
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
 * Обёртка входного потока: валидация до цепочки (схема описывает провод),
 * затем шаги цепочки, затем счётчик — `itemsIn` считает то, что
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
 * `T → T`, так что оба конца — провод), затем счётчик `itemsOut`.
 *
 * Обёртку завершения (`.finally`) навешивает пайплайн отдельно и позже —
 * она обязана быть самой внешней.
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

  return countItems(
    current,
    ctx.summary,
    'itemsOut',
  ) as AsyncIterableIterator<T>;
}

/**
 * Обёртка завершения: выполняет `onSettled` ровно один раз — на нормальном
 * конце потока, на ошибке и на закрытии потребителем (`return()`).
 *
 * Именно закрытие итератора выполняет отложенные `.finally`-юниты, поэтому
 * контракт с транспортом прост: потребить итератор до конца **либо**
 * закрыть его.
 *
 * @param onSettled - получает ошибку потока (или `undefined`) и возвращает
 * значение, которое нужно бросить вместо неё
 */
export async function* withFinish<T>(
  source: AsyncIterable<T>,
  onSettled: (error: unknown) => Promise<unknown> | unknown,
): AsyncIterableIterator<T> {
  let failure: unknown;
  let failed = false;

  try {
    yield* source;
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const replacement = await onSettled(failed ? failure : undefined);
    if (failed) {
      // Единственный способ пробросить отказ наружу: в catch он намеренно
      // перехвачен, чтобы finally-юниты увидели исход до его
      // распространения. Ветка сама «съесть» ничего не может — `failed`
      // взводится только в catch.
      // eslint-disable-next-line no-unsafe-finally
      throw replacement === undefined ? failure : replacement;
    }
  }
}
