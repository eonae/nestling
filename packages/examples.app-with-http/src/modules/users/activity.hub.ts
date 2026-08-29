import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { Injectable } from '@nestling/container';
import { Topic } from '@nestling/streams';

/** Событие ленты активности: его получает каждый подписчик SSE-endpoint'а. */
export interface ActivityEvent {
  id: string;
  kind: 'created' | 'updated' | 'deleted';
  userId: string;
  at: string;
}

/**
 * Хаб активности — **обычный singleton-провайдер**, а не особый вид
 * endpoint'а: источник событий регистрируется в `providers:` как любой
 * другой сервис.
 *
 * Внутри — `Topic`: публикация не ждёт подписчиков, буфер на подписчика
 * ограничен, медленный клиент не тормозит остальных.
 */
@Injectable([ILogger])
export class ActivityHub {
  readonly #topic = new Topic<ActivityEvent>({ buffer: 256 });
  #sequence = 0;

  constructor(private readonly logger: ILoggerService) {}

  /** Публикует событие; вызов не ждёт ни одного подписчика */
  publish(kind: ActivityEvent['kind'], userId: string): void {
    this.#sequence += 1;

    this.#topic.push({
      id: String(this.#sequence),
      kind,
      userId,
      at: new Date().toISOString(),
    });
  }

  /**
   * Подписка на ленту. `signal` — сигнал запроса: когда клиент отвалится,
   * итерация завершится сама, и подписка снимется с темы.
   */
  subscribe(signal?: AbortSignal): AsyncIterableIterator<ActivityEvent> {
    this.logger.log(`Activity subscription opened (${this.subscribers + 1})`);
    return this.#topic.subscribe(signal);
  }

  /** Число живых подписок — для наблюдаемости */
  get subscribers(): number {
    return this.#topic.subscribers;
  }

  /** Закрывает ленту: все подписки завершаются нормально */
  close(): void {
    this.#topic.close();
  }
}
