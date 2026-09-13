import { Component } from '@nestlingjs/container';

/**
 * Список адресов, на которые письма не уходят.
 *
 * Знание принадлежит тому, кто шлёт письма: жалоба на спам и отказ
 * сервера приходят сюда, а не в фичу пользователей. Соседняя фича
 * спрашивает список операцией `notifications.check-address`.
 *
 * Список в памяти: в настоящем сервисе это таблица. Пример показывает
 * границу фич, а не хранение — поэтому здесь `Set`.
 */
@Component([])
export class Suppressions {
  readonly #blocked = new Map<string, string>();

  /** Причина отказа или `undefined`, если адрес годен */
  reasonFor(email: string): string | undefined {
    if (email.endsWith('@example.invalid')) {
      return 'domain does not accept mail';
    }

    return this.#blocked.get(email);
  }

  /** Убирает адрес из рассылок */
  suppress(email: string, reason: string): void {
    this.#blocked.set(email, reason);
  }

  /** Сколько адресов в списке; читает только тест */
  get size(): number {
    return this.#blocked.size;
  }
}
