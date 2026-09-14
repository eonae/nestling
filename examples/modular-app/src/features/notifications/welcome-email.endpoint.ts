import type { UserRegisteredInput } from '../../operations.js';
import { UserRegistered } from '../../operations.js';
import { inbox, transactional } from '../../persistence.js';

import type { Mailer } from './mailer.js';
import { Mailer$ } from './mailer.js';
import { welcome } from './templates.js';

import type { Logger } from '@nestlingjs/app';
import { compose, implement, Logger$ } from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/** Сколько раз пробуем отправить письмо, прежде чем сдаться */
const ATTEMPTS = 3;

/** Пауза между попытками, миллисекунды */
const BACKOFF_MS = 50;

/**
 * Подписчик факта регистрации: шлёт приветственное письмо.
 *
 * Дедупликацию хендлер не делает: повтор до него не доходит. Ключ
 * идемпотентности кладёт в контекст слой приёма — он берёт его из
 * конверта сообщения, а relay ставит ключом идентификатор записи
 * outbox'а.
 */
@Handler([Mailer$, Logger$.auto])
export class WelcomeEmailHandler {
  constructor(
    private readonly mailer: Mailer,
    private readonly logger: Logger,
  ) {}

  async handle(
    payload: UserRegisteredInput,
    meta: { idempotencyKey: string },
  ): Promise<void> {
    const letter = welcome(payload);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        await this.mailer.send(payload.email, letter);

        this.logger.info('welcome email sent', {
          email: payload.email,
          attempt,
          idempotencyKey: meta.idempotencyKey,
        });

        return;
      } catch (error) {
        this.logger.warn('welcome email failed', {
          email: payload.email,
          attempt,
          reason: error instanceof Error ? error.message : String(error),
        });

        if (attempt === ATTEMPTS) {
          // Отметка приёма коммитится той же транзакцией, что и работа
          // подписчика. Исключение откатывает её вместе с работой, и
          // брокер доставит сообщение снова
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS));
      }
    }
  }
}

/**
 * Реализация события: имя подписчика — адрес подписки.
 *
 * В одном процессе оно различает подписки на одно событие
 * (`users.registered@welcome-email`), у брокера становится именем
 * queue-группы и durable-потребителя.
 *
 * Слой приёма композируется **внутрь** слоя транзакции: отметка
 * «обработано» и работа подписчика коммитятся вместе, а отметка живёт по
 * паре «паттерн endpoint'а и ключ идемпотентности».
 */
export const WelcomeEmail = implement(UserRegistered, {
  subscriber: 'welcome-email',
  pipeline: compose(transactional, inbox.layer),
  handler: WelcomeEmailHandler,
});
