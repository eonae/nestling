/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`), и `return;`
 * ему не соответствует. */
/**
 * Фича-потребитель: принимает команду и зовёт чужой контракт.
 *
 * Ни строки про транспорт, брокер или процессы. Всё, что она знает, —
 * контракты соседей; где живут их владельцы, решает сборка.
 */

import { TenantId } from './context';
import { ClaimQuota, OrderPlaced, PlaceOrder } from './contracts';

import { makeAppModule, makeFeature } from '@nestling/app';
import { Injectable } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, makePipeline } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { implement } from '@nestling/ports';

/**
 * Сервис размещения заказа.
 *
 * Инжектит **вызыватели**, а не соседей: `Port` и `Emitter` — обычные узлы
 * графа, и call-site у них один и тот же независимо от того, co-located
 * реализация или в другом процессе. Именно это делает переезд фичи в
 * отдельный процесс правкой корня, а не правкой кода.
 */
@Injectable([ClaimQuota.port, OrderPlaced.emitter, Ctx(TenantId)])
export class PlaceOrderService {
  constructor(
    private readonly quotas: Port<typeof ClaimQuota>,
    private readonly placed: Emitter<typeof OrderPlaced>,
    private readonly tenant: CtxReader<string>,
  ) {}

  async place(orderId: string, amount: number): Promise<void> {
    const tenantId = this.tenant.get();

    const claim = await this.quotas.call({ tenantId, amount });

    if (claim.isFail) {
      // Задекларированный отказ приезжает **настоящим** `Fail` того же
      // определения — и по проводу, и co-located: ре-гидрация идёт по коду
      return;
    }

    await this.placed.emit({ orderId, tenantId });
  }
}

const OrdersModule = makeAppModule({
  name: 'module:orders',
  providers: [PlaceOrderService],
  endpoints: [
    implement(PlaceOrder, {
      // Провозимое значение приезжает конвертом и проецируется в
      // ambient-контекст штатным писателем. Дальше вглубь оно едет само:
      // вызыватель соберёт его из ячейки этого запроса
      pipeline: makePipeline().pre(TenantId.propagated()),
      deps: [PlaceOrderService],
      handle:
        (service: PlaceOrderService) =>
        async (input: { orderId: string; amount: number }) => {
          await service.place(input.orderId, input.amount);

          return undefined;
        },
    }),
  ],
});

/** Фича приёма заказов */
export const OrdersFeature = makeFeature({
  name: 'orders',
  modules: [OrdersModule],
});
