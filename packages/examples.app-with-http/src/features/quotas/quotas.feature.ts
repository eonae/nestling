import type {
  ClaimQuotaInput,
  SignupRecordedInput,
  UserRegisteredInput,
} from '../../operations';
import {
  ClaimQuota,
  QuotaExceeded,
  SignupRecorded,
  UserRegistered,
} from '../../operations';
import type { Logger } from '../../plugins/logging';
import { Logger$ } from '../../plugins/logging';

import { QuotaService } from './quota.service';
import { SignupJournal } from './signup.journal';

import { makeFeature } from '@nestling/app';
import { makePipeline } from '@nestling/pipeline';
import { implement, withIdempotencyKey } from '@nestling/ports';

/**
 * Реализация запроса `quotas.claim`: декларация endpoint'а на транспорте
 * шины. `input`, `output` и `errors` принадлежат операции и здесь не
 * повторяются. Всё остальное как у HTTP-endpoint'а: `deps`, формы
 * `handle`, участие в discovery и политиках, вызов по значению в тестах.
 */
export const ClaimQuotaImpl = implement(ClaimQuota, {
  handler: {
    deps: [QuotaService, Logger$],
    handle:
      (quotas: QuotaService, logger: Logger) =>
      async (payload: ClaimQuotaInput) => {
        const claimed = quotas.claim();

        if (!claimed.ok) {
          logger.log(`quota exhausted, refusing ${payload.email}`);

          // Вызывающий получит `Fail` и узнает его через `QuotaExceeded.is()`
          return QuotaExceeded({ limit: quotas.limit });
        }

        return { remaining: claimed.remaining };
      },
  },
});

/**
 * Подписчик события `users.registered`.
 *
 * У события может быть несколько подписчиков, поэтому `subscriber`
 * обязателен: он различает подписки в процессе (`users.registered@quotas`)
 * и становится именем queue-group у брокера.
 */
export const UserRegisteredInQuotas = implement(UserRegistered, {
  subscriber: 'quotas',
  handler: {
    deps: [Logger$],
    handle: (logger: Logger) => async (payload: UserRegisteredInput) => {
      logger.log(`quota bookkeeping: user ${payload.id} (${payload.email})`);

      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined;
    },
  },
});

/**
 * Реализация команды `quotas.record-signup`.
 *
 * Pre-юнит `withIdempotencyKey()` кладёт ключ в контекст, и сервис читает
 * его через `Ctx(IdempotencyKey)`. Что юнит есть в пайплайне, проверяет
 * политика в `root.ts`.
 */
export const SignupRecordedImpl = implement(SignupRecorded, {
  pipeline: makePipeline().pre(withIdempotencyKey()),
  handler: {
    deps: [SignupJournal],
    handle: (journal: SignupJournal) => async (payload: SignupRecordedInput) => {
      journal.record(payload.userId);

      // eslint-disable-next-line unicorn/no-useless-undefined
      return undefined;
    },
  },
});

/**
 * Фича квот: владелец `quotas.claim` и `quotas.record-signup`, подписчик
 * `users.registered`.
 *
 * В `providers:` только собственные сервисы. Наружу фича отдаёт операции,
 * а не токены, поэтому её можно вынести в отдельный процесс без правок в
 * фиче `users`.
 */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],
});
