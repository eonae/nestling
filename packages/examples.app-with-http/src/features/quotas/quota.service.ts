import { Injectable } from '@nestling/container';

/**
 * Счётчик квоты: сервис фичи квот.
 *
 * Наружу не экспортируется и в `deps` других фич не попадает: соседняя
 * фича обращается к квотам через операцию `quotas.claim`.
 */
@Injectable([])
export class QuotaService {
  /** Лимит пользователей; в примере намеренно маленький */
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
}
