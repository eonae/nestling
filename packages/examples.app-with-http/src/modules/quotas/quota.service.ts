import { Injectable } from '@nestling/container';

/**
 * Счётчик квоты: обычный сервис фичи квот.
 *
 * Наружу он не экспортируется и в `deps` других фич не попадает: соседняя
 * фича обращается к квотам через контракт. Если `quotas` вынести в
 * отдельный процесс, контракт продолжит работать, а общий токен — нет.
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

  /** Сколько мест уже занято */
  get used(): number {
    return this.#used;
  }
}
