/**
 * Юнит отметки и слой приёма.
 *
 * Юнит ставит отметку транзакцией вызывающего и завершает endpoint
 * досрочным успехом, если сообщение уже обработано. Слой — значение:
 * политика `requiresInbox` сравнивает его по ссылке.
 */

import { readIdempotencyKey } from './key.js';
import type { InboxStore } from './types.js';

import type {
  CtxReader,
  Done,
  EmptyInput,
  ExtendableContext,
  Logger,
  Pipeline,
} from '@nestlingjs/app';
import { done, makePipeline } from '@nestlingjs/app';

/** Контекст, который юнит отметки видит: ключ положил писатель перед ним */
type ClaimContext = ExtendableContext<EmptyInput & { idempotencyKey: string }>;

/**
 * Ставит отметку приёма и отсекает повтор.
 *
 * Зависимости приходят из контейнера: хранилище под DI-токеном
 * приложения, транзакция — ридером переменной контекста. Провайдер
 * собирает плагин: список зависимостей известен только там, где объявлен
 * словарь `inbox({ transaction, store })`.
 */
export class InboxClaimUnit {
  constructor(
    private readonly store: InboxStore,
    private readonly transaction: CtxReader<unknown>,
    private readonly logger: Logger,
  ) {}

  /**
   * @returns `done()` у повтора, `undefined` у первой доставки
   * @throws {ContextVarUnavailableError} Слой композирован снаружи слоя
   * транзакции, и транзакции в контексте нет
   */
  async handle(ctx: ClaimContext): Promise<Done | undefined> {
    const consumer = ctx.raw.pattern;
    const key = ctx.input.idempotencyKey;

    const outcome = await this.store.claim(this.transaction.get(), {
      consumer,
      key,
      receivedAt: Date.now(),
    });

    if (outcome === 'claimed') {
      return undefined;
    }

    // Факт уходит строкой логгера, а не операцией: он случается внутри
    // транзакции вызывающего, и отправка события оттуда потребовала бы
    // транзакционного эмиттера, а нетранзакционный `emit` отправил бы
    // факт даже при последующем откате
    this.logger.info('inbox skipped a duplicate', {
      consumer,
      idempotencyKey: key,
    });

    return done();
  }
}

/**
 * Слой приёма: писатель ключа и юнит отметки.
 *
 * Значение создаётся один раз на вызов `inbox(...)`. Функцией слой не
 * делается: `hasLayer` сравнивает по ссылке, и новый пайплайн на каждый
 * вызов политика не засчитала бы.
 */
export const makeInboxLayer = (): Pipeline<
  EmptyInput,
  EmptyInput & { idempotencyKey: string },
  typeof InboxClaimUnit
> =>
  makePipeline().pre(readIdempotencyKey()).pre(InboxClaimUnit, { done: true });
