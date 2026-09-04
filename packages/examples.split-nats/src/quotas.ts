/**
 * Фича `quotas`: владелец операции `quotas.claim` и подписчик факта
 * регистрации.
 *
 * Реализация операции — обычная декларация endpoint'а: discovery,
 * пайплайн и проверка входа по схеме работают так же, как у HTTP.
 * Транспортом служит шина, которую поставил корень.
 */

import { TenantId } from './context.js';
import type { UserRegisteredInput } from './operations.js';
import { ClaimQuota, QuotaExceeded, UserRegistered } from './operations.js';

import { makeFeature } from '@nestling/app';
import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, makePipeline } from '@nestling/pipeline';
import { implement } from '@nestling/ports';

/**
 * Учёт квот по арендаторам: сколько мест занято и кто заархивирован.
 *
 * Арендатор не передаётся параметром: сервис читает его из контекста
 * запроса ридером `Ctx(TenantId)`. Значение в контекст кладёт юнит
 * `TenantId.propagated()` в пайплайне реализации.
 */
@Injectable([Ctx(TenantId)])
export class QuotaLedger {
  readonly limit = 100;
  readonly used = new Map<string, number>();
  readonly archived: string[] = [];

  constructor(private readonly tenant: CtxReader<string>) {}

  /** Занимает место у текущего арендатора; возвращает остаток или `undefined` */
  claim(): number | undefined {
    const tenantId = this.tenant.get();
    const used = this.used.get(tenantId) ?? 0;

    if (used >= this.limit) {
      return undefined;
    }

    this.used.set(tenantId, used + 1);

    return this.limit - used - 1;
  }

  /** Записывает зарегистрированного пользователя текущего арендатора */
  archive(userId: string): void {
    this.archived.push(`${this.tenant.get()}:${userId}`);
  }
}

@Injectable([QuotaLedger])
class ClaimQuotaHandler {
  constructor(private readonly ledger: QuotaLedger) {}

  async handle() {
    const remaining = this.ledger.claim();

    return remaining === undefined
      ? QuotaExceeded({ limit: this.ledger.limit })
      : { remaining };
  }
}

@Injectable([QuotaLedger])
class UserRegisteredInArchiveHandler {
  constructor(private readonly ledger: QuotaLedger) {}

  async handle(payload: UserRegisteredInput) {
    this.ledger.archive(payload.id);

    // eslint-disable-next-line unicorn/no-useless-undefined
    return undefined;
  }
}

export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaLedger],
  endpoints: [
    implement(ClaimQuota, {
      // Арендатор пришёл в конверте сообщения: юнит возвращает его в
      // контекст запроса, и `QuotaLedger` читает его оттуда
      pipeline: makePipeline().pre(TenantId.propagated()),
      handler: ClaimQuotaHandler,
    }),

    implement(UserRegistered, {
      // Имя подписчика — адрес подписки: в одном процессе различает
      // подписки на одно событие, у брокера становится именем queue-группы
      // и durable-потребителя
      subscriber: 'archive',
      pipeline: makePipeline().pre(TenantId.propagated()),
      handler: UserRegisteredInArchiveHandler,
    }),
  ],
});
