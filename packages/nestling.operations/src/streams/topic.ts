/**
 * `Topic<T>` — примитив рассылки для источников событий.
 *
 * Ровно примитив: буфер ограниченного размера и `AbortSignal`. Ни
 * операторов, ни фабрик «на все случаи», ни наследования — всё это живёт
 * в пользовательском коде поверх обычного `AsyncIterable`.
 */

/** Что делать с подписчиком, который не успевает разбирать буфер */
export type SlowConsumerPolicy = 'drop-oldest' | 'disconnect';

export interface TopicOptions {
  /**
   * Размер буфера **на подписчика**. `0` отключает буферизацию: событие
   * достаётся только тому, кто уже ждёт `next()`.
   */
  buffer?: number;

  /** Политика переполнения буфера подписчика (по умолчанию `drop-oldest`) */
  onSlowConsumer?: SlowConsumerPolicy;
}

/** Буфер по умолчанию: с запасом на всплеск, но не безразмерный */
const DEFAULT_BUFFER = 1024;

/**
 * Состояние одной подписки: очередь + ожидающий потребитель.
 *
 * Ждать умеет только потребитель; `push` не ждёт никогда — в этом весь
 * смысл политики медленного подписчика.
 */
class Subscription<T> {
  private readonly queue: T[] = [];
  private waiter?: (result: IteratorResult<T>) => void;
  private done = false;

  /** Сколько событий этой подписки потеряно политикой `drop-oldest` */
  public dropped = 0;

  constructor(
    private readonly buffer: number,
    private readonly policy: SlowConsumerPolicy,
  ) {}

  push(value: T): number {
    if (this.done) {
      return 0;
    }

    // Потребитель уже ждёт — буфер не нужен вовсе
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value, done: false });
      return 0;
    }

    if (this.buffer <= 0) {
      // Буфера нет: событие для этого подписчика потеряно
      this.dropped += 1;
      return 1;
    }

    this.queue.push(value);
    if (this.queue.length <= this.buffer) {
      return 0;
    }

    if (this.policy === 'disconnect') {
      this.finish();
      return 0;
    }

    this.queue.shift();
    this.dropped += 1;
    return 1;
  }

  /** Завершает подписку нормально (без ошибки) */
  finish(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.queue.length = 0;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift() as T, done: false });
    }
    if (this.done) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

/**
 * Тема: публикация не зависит от наличия подписчиков и никогда не ждёт
 * медленного потребителя.
 *
 * @example
 * ```typescript
 * class ActivityHub {
 *   readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });
 *
 *   publish(event: ActivityEvent): void {
 *     this.#topic.push(event);
 *   }
 *
 *   subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
 *     return this.#topic.subscribe(signal);
 *   }
 * }
 * ```
 */
export class Topic<T> {
  readonly #subscriptions = new Set<Subscription<T>>();
  readonly #buffer: number;
  readonly #policy: SlowConsumerPolicy;

  #closed = false;
  #dropped = 0;

  constructor(options: TopicOptions = {}) {
    this.#buffer = options.buffer ?? DEFAULT_BUFFER;
    this.#policy = options.onSlowConsumer ?? 'drop-oldest';
  }

  /** Число активных подписок */
  get subscribers(): number {
    return this.#subscriptions.size;
  }

  /**
   * Сколько событий не попало к подписчикам из-за переполнения буфера.
   *
   * Потеря по политике `drop-oldest` тиха по построению — счётчик делает
   * её наблюдаемой.
   */
  get dropped(): number {
    return this.#dropped;
  }

  /** Закрыта ли тема (`close()` уже вызывался) */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Публикует значение. Возврат немедленный при любом числе подписчиков,
   * включая ноль.
   */
  push(value: T): void {
    if (this.#closed) {
      return;
    }

    for (const subscription of this.#subscriptions) {
      this.#dropped += subscription.push(value);
    }
  }

  /**
   * Подписка — стандартный `AsyncIterableIterator`.
   *
   * Завершается: по взведению `signal`, по `close()` темы и по выходу
   * потребителя из итерации (`break`/`return()`). В любом случае буфер
   * освобождается, а подписка снимается с темы.
   */
  subscribe(signal?: AbortSignal): AsyncIterableIterator<T> {
    const subscription = new Subscription<T>(this.#buffer, this.#policy);
    const subscriptions = this.#subscriptions;

    // Закрытая тема отдаёт пустую подписку: считать её активной незачем
    if (this.#closed || signal?.aborted) {
      subscription.finish();
    } else {
      subscriptions.add(subscription);
    }

    const onAbort = (): void => {
      subscription.finish();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const release = (): void => {
      signal?.removeEventListener('abort', onAbort);
      subscription.finish();
      subscriptions.delete(subscription);
    };

    // Не генератор: тело генератора не выполняется до первого `next()`, и
    // подписка, закрытая до начала итерации, осталась бы висеть на теме.
    // Явный объект-итератор освобождает ресурсы в `return()` независимо от
    // того, начиналась итерация или нет.
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
      async next(): Promise<IteratorResult<T>> {
        const result = await subscription.next();
        if (result.done) {
          release();
        }
        return result;
      },
      async return(): Promise<IteratorResult<T>> {
        release();
        return { value: undefined, done: true };
      },
      async throw(error: unknown): Promise<IteratorResult<T>> {
        release();
        throw error;
      },
    };
  }

  /**
   * Закрывает тему: все подписки завершаются **нормально** (без ошибки),
   * последующий `push` — no-op.
   */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    for (const subscription of this.#subscriptions) {
      subscription.finish();
    }
    this.#subscriptions.clear();
  }
}
