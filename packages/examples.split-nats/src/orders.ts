/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `return;`
 * ему не соответствует. */
/**
 * Фича-потребитель: принимает команду и зовёт чужая операция.
 *
 * Ни строки про транспорт, брокер или процессы. Всё, что она знает, —
 * операции соседей; где живут их владельцы, решает сборка.
 */

import { TenantId } from './context';
import { ClaimQuota, OrderPlaced, PlaceOrder } from './contracts';

import { makeFeature } from '@nestling/app';
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
@Injectable([ClaimQuota.caller, OrderPlaced.emitter, Ctx(TenantId)])
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
      // Задекларированный отказ приходит **настоящим** `Fail` того же
      // определения и по сети, и co-located: `Fail` из сетевого ответа
      // восстанавливает код порта, а не эта фича
      return;
    }

    await this.placed.emit({ orderId, tenantId });
  }
}

/** Фича приёма заказов */
export const OrdersFeature = makeFeature({
  name: 'orders',
  providers: [PlaceOrderService],
  endpoints: [
    implement(PlaceOrder, {
      // Провозимое значение приходит конвертом и проецируется в
      // ambient-контекст штатным писателем. Дальше вглубь оно передаётся
      // само: вызыватель соберёт его из ячейки этого запроса
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
