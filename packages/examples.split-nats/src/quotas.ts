/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`), и `return;`
 * ему не соответствует. */
/**
 * Фича-владелец: реализует контракт квот и слушает факт размещения.
 *
 * Реализация контракта — обычная декларация: дискавери, `dispatch`,
 * pipeline, страж границы и policy-check достаются ей даром, а транспортом
 * оказывается шина — та, которую поставил корень.
 */

import { TenantId } from './context';
import { ClaimQuota, OrderPlaced, QuotaExceeded } from './contracts';

import { makeAppModule, makeFeature } from '@nestling/app';
import { Injectable } from '@nestling/container';
import { makePipeline, Ok } from '@nestling/pipeline';
import { implement } from '@nestling/ports';

/** Лимит на арендатора — жёстко, чтобы пример читался целиком */
const LIMIT = 100;

/** Журнал квот: сколько уже выдано и что заархивировано */
@Injectable([])
export class QuotaLedger {
  readonly granted = new Map<string, number>();
  readonly archived: string[] = [];

  claim(tenantId: string, amount: number): number | undefined {
    const used = this.granted.get(tenantId) ?? 0;

    if (used + amount > LIMIT) {
      return undefined;
    }

    this.granted.set(tenantId, used + amount);

    return amount;
  }
}

const QuotasModule = makeAppModule({
  name: 'module:quotas',
  providers: [QuotaLedger],
  endpoints: [
    implement(ClaimQuota, {
      deps: [QuotaLedger],
      handle:
        (ledger: QuotaLedger) =>
        async (input: { tenantId: string; amount: number }) => {
          const granted = ledger.claim(input.tenantId, input.amount);

          return granted === undefined
            ? QuotaExceeded({ tenantId: input.tenantId })
            : new Ok({ granted });
        },
    }),

    implement(OrderPlaced, {
      // Имя подписчика — адрес подписки, оно же имя queue-группы и
      // durable-потребителя. Задаётся явно: выводить сетевой адрес из
      // имени модуля значило бы привязать его к структуре кода
      subscriber: 'archive',
      // Тот же провозимый арендатор — уже в другом процессе
      pipeline: makePipeline().pre(TenantId.propagated()),
      deps: [QuotaLedger],
      handle:
        (ledger: QuotaLedger) =>
        async (input: { orderId: string; tenantId: string }) => {
          ledger.archived.push(`${input.tenantId}:${input.orderId}`);

          return undefined;
        },
    }),
  ],
});

/** Фича квот: владелец `quotas.claim` и подписчик `orders.placed` */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  modules: [QuotasModule],
});
