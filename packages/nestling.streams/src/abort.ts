/**
 * Утилиты итерации под `AbortSignal`.
 *
 * Публичная граница — стандартные `AsyncIterable`/`AsyncIterableIterator`;
 * собственного типа потока пакет не вводит.
 */

/** Маркер «гонку выиграл сигнал», а не источник */
const ABORTED = Symbol('aborted');

/**
 * Ждёт `signal` один раз, отдавая промис и функцию отписки.
 *
 * Отдельная функция потому, что слушатель обязан быть **один на итерацию**:
 * навешивать его в цикле по элементам — гарантированная утечка на длинном
 * потоке.
 */
function abortPromise(signal: AbortSignal): {
  promise: Promise<typeof ABORTED>;
  dispose: () => void;
} {
  // Definite assignment: исполнитель промиса синхронный, к моменту return
  // слушатель уже создан
  let onAbort!: () => void;

  const promise = new Promise<typeof ABORTED>((resolve) => {
    onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
  });

  return {
    promise,
    dispose: () => signal.removeEventListener('abort', onAbort),
  };
}

/**
 * Завершает итерацию по взведению сигнала, корректно закрывая источник
 * (`return()`), — чтобы `try/finally` внутри генератора-источника
 * отработал, а подписки снялись.
 *
 * Без сигнала — прозрачная обёртка.
 */
export async function* untilAborted<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncIterableIterator<T> {
  if (!signal) {
    yield* source;
    return;
  }

  if (signal.aborted) {
    return;
  }

  const iterator = source[Symbol.asyncIterator]();
  const abort = abortPromise(signal);

  try {
    for (;;) {
      const result = await Promise.race([iterator.next(), abort.promise]);
      if (result === ABORTED || result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    abort.dispose();
    await iterator.return?.();
  }
}

/**
 * Собирает поток в массив. Нужна тестам и коду, которому проще получить
 * готовый список, чем писать цикл.
 */
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}
