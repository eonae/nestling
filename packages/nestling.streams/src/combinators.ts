/**
 * Реализация комбинаторов item-цепочки.
 *
 * Словарь **закрытый и инфраструктурный**: `tap`, `filter`, `limit`,
 * `gapTimeout`, `throttle`, `batch`, `through`. Комбинаторов с
 * реордерингом времени, слиянием потоков и higher-order streams здесь нет
 * и не будет — это dataflow-программирование, его место в хендлере, где
 * автор волен взять любую библиотеку.
 *
 * Каждый комбинатор — функция над `AsyncIterable`, поэтому одна и та же
 * реализация обслуживает формы io ядра и satellite-пакеты.
 */

import { StreamGapTimeoutError, StreamLimitError } from './errors.js';

/** Наблюдение за элементом; исключение из `fn` прерывает поток */
export async function* tap<T>(
  source: AsyncIterable<T>,
  fn: (item: T) => void,
): AsyncIterableIterator<T> {
  for await (const item of source) {
    fn(item);
    yield item;
  }
}

/** Отбор элементов; отброшенные до потребителя не доходят */
export async function* filter<T>(
  source: AsyncIterable<T>,
  predicate: (item: T) => boolean,
): AsyncIterableIterator<T> {
  for await (const item of source) {
    if (predicate(item)) {
      yield item;
    }
  }
}

/**
 * Верхняя граница числа элементов.
 *
 * `max`-й элемент отдаётся, на `max + 1`-м поток отказывает: лимит — это
 * контракт, а не тихая обрезка.
 *
 * @param onExceeded - фабрика отказа; ядро подставляет kernel-отказ
 * `STREAM_LIMIT_EXCEEDED` (413)
 */
export async function* limit<T>(
  source: AsyncIterable<T>,
  max: number,
  onExceeded: (max: number) => unknown = (value) => new StreamLimitError(value),
): AsyncIterableIterator<T> {
  let seen = 0;

  for await (const item of source) {
    seen += 1;
    if (seen > max) {
      throw onExceeded(max);
    }
    yield item;
  }
}

/**
 * Таймаут молчания: между двумя элементами (и до первого) источник обязан
 * укладываться в `ms`.
 *
 * Считается пауза **источника**, а не время обработки потребителем: ждём
 * только `next()`.
 */
export async function* gapTimeout<T>(
  source: AsyncIterable<T>,
  ms: number,
  onTimeout: (ms: number) => unknown = (value) =>
    new StreamGapTimeoutError(value),
): AsyncIterableIterator<T> {
  const iterator = source[Symbol.asyncIterator]();
  const TIMED_OUT = Symbol('timeout');

  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      });

      let result: IteratorResult<T> | typeof TIMED_OUT;
      try {
        result = await Promise.race([iterator.next(), deadline]);
      } finally {
        clearTimeout(timer);
      }

      if (result === TIMED_OUT) {
        throw onTimeout(ms);
      }
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

/**
 * Ограничение частоты: не более `perSecond` элементов в секунду.
 *
 * Элементы **буферизуются** временем, а не отбрасываются: pull-модель сама
 * создаёт backpressure у источника. Ронять элементы умеет только `Topic`
 * и только по своей политике.
 */
export async function* throttle<T>(
  source: AsyncIterable<T>,
  perSecond: number,
): AsyncIterableIterator<T> {
  if (perSecond <= 0) {
    throw new RangeError('throttle(perSecond) expects a positive rate');
  }

  const interval = 1000 / perSecond;
  let nextAt = 0;

  for await (const item of source) {
    const now = Date.now();
    const wait = nextAt - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    nextAt = Math.max(now, nextAt) + interval;
    yield item;
  }
}

/**
 * Группировка по `size`. Остаток отдаётся на завершении источника —
 * иначе хвост данных потерялся бы молча.
 */
export async function* batch<T>(
  source: AsyncIterable<T>,
  size: number,
): AsyncIterableIterator<T[]> {
  if (size <= 0) {
    throw new RangeError('batch(size) expects a positive size');
  }

  let bucket: T[] = [];

  for await (const item of source) {
    bucket.push(item);
    if (bucket.length === size) {
      yield bucket;
      bucket = [];
    }
  }

  if (bucket.length > 0) {
    yield bucket;
  }
}

/**
 * Единственный escape hatch словаря: произвольная трансформация потока.
 *
 * Объявлена в декларации честно — тип-меняющий `through` виден в контракте
 * и потому недопустим в слоте `output`.
 */
export function through<T, TNext>(
  source: AsyncIterable<T>,
  fn: (src: AsyncIterable<T>) => AsyncIterable<TNext>,
): AsyncIterable<TNext> {
  return fn(source);
}
