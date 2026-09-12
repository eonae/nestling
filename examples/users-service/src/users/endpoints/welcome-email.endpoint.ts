import { appInbox, subscribed } from '../../persistence.js';
import { UserCreated } from '../users.events.js';

import type { Logger, Output } from '@nestlingjs/app';
import { compose, implement, Logger$ } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';

/**
 * Подписчик факта: отправляет приветственное письмо.
 *
 * Дедупликацию хендлер не делает: повтор до него не доходит. Ключ
 * идемпотентности кладёт в контекст слой приёма — он берёт его из
 * конверта сообщения, а relay ставит ключом идентификатор записи
 * outbox'а.
 */
@Handler([Logger$.auto])
export class WelcomeEmailHandler {
  constructor(private readonly logger: Logger) {}

  async handle(
    payload: { id: string; name: string; email: string },
    meta: { idempotencyKey: string },
  ): Output<undefined> {
    this.logger.info('welcome email sent', {
      id: payload.id,
      email: payload.email,
      idempotencyKey: meta.idempotencyKey,
    });

    return new Ok(undefined);
  }
}

/**
 * Реализация события: имя подписчика — часть адреса внутри процесса.
 *
 * Слой приёма композируется **внутрь** слоя транзакции: отметка
 * «обработано» и письмо коммитятся вместе, а отметка живёт по паре
 * «паттерн endpoint'а и ключ идемпотентности».
 *
 * В настоящем приложении подписчик жил бы в соседней фиче: сосед узнаёт о
 * случившемся операцией, а не DI-токеном. Здесь фича одна, и подписчик
 * лежит рядом.
 */
export const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: compose(subscribed, appInbox.layer),
  handler: WelcomeEmailHandler,
});
