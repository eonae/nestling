/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
import {
  ClaimQuota,
  QuotaExceeded,
  SignupRecorded,
  UserRegistered,
} from '../../operations';
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { QuotaService } from './quota.service';
import { SignupJournal } from './signup.journal';

import { makeFeature } from '@nestling/app';
import { makePipeline, Ok } from '@nestling/pipeline';
import { implement, withIdempotencyKey } from '@nestling/ports';

/**
 * Реализация запроса `quotas.claim`: обычная декларация endpoint'а на
 * транспорте шины.
 *
 * От HTTP-endpoint'а отличаются только конструктор и адрес. Остальное то
 * же: `deps`, формы `handle`, получение зависимостей на фазе WIRE,
 * проверка отказов по `errors`, участие в discovery и `policies`, вызов
 * по значению в тестах. `input`, `output` и `errors` не переобъявляются:
 * они принадлежат операции.
 */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  deps: [QuotaService, ILogger],
  handle:
    (quotas: QuotaService, logger: ILoggerService) =>
    async (payload: { email: string }) => {
      const claimed = quotas.claim();

      if (!claimed.ok) {
        logger.log(`quota exhausted, refusing ${payload.email}`);

        // Отказ возвращается значением; вызывающий получит настоящий `Fail`
        // и распознает его через `QuotaExceeded.is(...)`
        return QuotaExceeded({ limit: quotas.limit });
      }

      return new Ok({ remaining: claimed.remaining });
    },
});

/**
 * Подписчик события `users.registered`.
 *
 * У события может быть несколько подписчиков, поэтому `subscriber`
 * обязателен: он различает подписки внутри процесса
 * (`users.registered@quotas`) и становится именем queue-group у брокера.
 */
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  deps: [ILogger],
  handle:
    (logger: ILoggerService) =>
    async (payload: { id: string; email: string }) => {
      logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);

      return undefined;
    },
});

/**
 * Реализация команды `quotas.record-signup`: ключ идемпотентности читает
 * сервис в глубине графа.
 *
 * Ключ доступен двумя путями. Первый — транспортные атрибуты
 * (`ctx.raw.attributes.idempotencyKey`), их заполняет любая привязка
 * порта. Второй — асинхронный контекст: pre-юнит `withIdempotencyKey()`
 * кладёт ключ в контекст, и код на любой глубине читает его через
 * `Ctx(IdempotencyKey)`, не получая параметром. Что юнит есть в
 * пайплайне, проверяет на сборке `everyEndpoint(…).hasVar(IdempotencyKey)`.
 */
export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  deps: [SignupJournal],
  handle:
    (journal: SignupJournal) =>
    async (payload: { userId: string; email: string }) => {
      // Ключ есть всегда: его передал вызывающий или сгенерировал порт.
      // Сервис читает ключ из контекста, а не из параметра
      journal.record(payload.userId);

      return undefined;
    },
});

/**
 * Фича квот: реализует операцию `quotas.claim` и подписана на событие
 * `users.registered`.
 *
 * В `providers:` только собственные сервисы: наружу фича отдаёт не токены,
 * а операции. Поэтому её можно вынести в отдельный процесс, не меняя код
 * фичи `users`: изменится привязка вызывателей на сборке, а не вызовы.
 */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],
});
