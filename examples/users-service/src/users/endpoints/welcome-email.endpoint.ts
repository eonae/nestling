import { UserCreated } from '../users.events.js';

import type { Logger, Output } from '@nestlingjs/app';
import {
  implement,
  Logger$,
  makePipeline,
  withIdempotencyKey,
} from '@nestlingjs/app';
import { Handler, makeToken } from '@nestlingjs/container';
import { Ok } from '@nestlingjs/operations';

/** Уже обработанные ключи: дедупликация — обязанность подписчика */
export const SeenKeys$ = makeToken<Set<string>>('SeenKeys');

/**
 * Подписчик факта: отправляет приветственное письмо.
 *
 * Ключ идемпотентности кладёт в контекст штатный писатель ядра
 * `withIdempotencyKey()`. У события типизированного `meta.idempotencyKey`
 * нет: он приходит атрибутом конверта, потому что доставка at-least-once
 * — свойство шины, а не вида операции. Relay ставит ключом идентификатор
 * записи outbox'а, поэтому повтор доставки узнаётся по нему.
 */
@Handler([Logger$.auto, SeenKeys$])
export class WelcomeEmailHandler {
  constructor(
    private readonly logger: Logger,
    private readonly seen: Set<string>,
  ) {}

  async handle(
    payload: { id: string; name: string; email: string },
    meta: { idempotencyKey: string },
  ): Output<undefined> {
    if (this.seen.has(meta.idempotencyKey)) {
      this.logger.info('welcome email skipped as duplicate', {
        id: payload.id,
      });

      return new Ok(undefined);
    }

    this.seen.add(meta.idempotencyKey);
    this.logger.info('welcome email sent', {
      id: payload.id,
      email: payload.email,
    });

    return new Ok(undefined);
  }
}

/**
 * Реализация события: имя подписчика — часть адреса внутри процесса.
 *
 * В настоящем приложении подписчик жил бы в соседней фиче: сосед узнаёт о
 * случившемся операцией, а не DI-токеном. Здесь фича одна, и подписчик
 * лежит рядом.
 */
export const WelcomeEmail = implement(UserCreated, {
  subscriber: 'welcome-email',
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: WelcomeEmailHandler,
});
