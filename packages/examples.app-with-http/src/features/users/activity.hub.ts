import { Injectable, OnDestroy } from '@nestling/container';
import { Topic } from '@nestling/streams';

/** Событие ленты активности: его получает каждый подписчик SSE-endpoint'а */
export interface ActivityEvent {
  id: string;
  kind: 'created' | 'updated' | 'deleted';
  userId: string;
  at: string;
}

/** Сколько последних событий хранится для реконнекта */
const HISTORY_SIZE = 256;

/**
 * Источник событий ленты: обычный провайдер поверх `Topic`.
 *
 * `push` не ждёт подписчиков, у каждой подписки свой буфер, медленный
 * клиент не тормозит остальных.
 */
@Injectable([])
export class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });

  /** Последние события: с них продолжается подписка после реконнекта */
  readonly #history: ActivityEvent[] = [];

  #sequence = 0;

  /** Публикует событие; вызов не ждёт ни одного подписчика */
  publish(kind: ActivityEvent['kind'], userId: string): void {
    this.#sequence += 1;

    const event: ActivityEvent = {
      id: String(this.#sequence),
      kind,
      userId,
      at: new Date().toISOString(),
    };

    this.#history.push(event);
    if (this.#history.length > HISTORY_SIZE) {
      this.#history.shift();
    }

    this.#topic.push(event);
  }

  /**
   * Подписка на ленту.
   *
   * Сначала отдаёт события с идентификатором больше `since`, затем живые.
   * Когда `signal` взведён, итерация завершается.
   */
  async *subscribe(
    signal?: AbortSignal,
    since = '0',
  ): AsyncIterableIterator<ActivityEvent> {
    const live = this.#topic.subscribe(signal);
    let last = Number(since);

    for (const event of this.#history) {
      if (Number(event.id) > last) {
        last = Number(event.id);
        yield event;
      }
    }

    for await (const event of live) {
      if (Number(event.id) > last) {
        last = Number(event.id);
        yield event;
      }
    }
  }

  /** Число открытых подписок */
  get subscribers(): number {
    return this.#topic.subscribers;
  }

  /** При остановке приложения все подписки завершаются нормально */
  @OnDestroy()
  close(): void {
    this.#topic.close();
  }
}
