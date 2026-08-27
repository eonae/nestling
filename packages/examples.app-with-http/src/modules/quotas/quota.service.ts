import { Injectable } from '@nestling/container';

/**
 * Счётчик квоты — обычный сервис своей фичи.
 *
 * Наружу он не экспортируется и в чужие `deps` не попадает: соседняя фича
 * общается с квотами **контрактом**, а не токеном. Разница видна в день,
 * когда `quotas` уедет в отдельный процесс: контракт переживёт переезд,
 * общий токен — нет.
 */
@Injectable([])
export class QuotaService {
  /** Лимит пользователей в этой сборке — намеренно маленький для витрины */
  readonly limit = 5;

  #used = 0;

  /** Занимает место или отвечает «мест нет» */
  claim(): { ok: true; remaining: number } | { ok: false } {
    if (this.#used >= this.limit) {
      return { ok: false };
    }

    this.#used += 1;

    return { ok: true, remaining: this.limit - this.#used };
  }

  /** Сколько мест уже занято — читает подписчик события */
  get used(): number {
    return this.#used;
  }
}
