/**
 * Типовые тесты словаря `meta` вызывающей стороны.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Emitter, MetaOf, Port } from './families.js';
import { makeCommand, makeEvent, makeRequest } from './operation.js';

import { z } from 'zod';

const ClaimQuota = makeRequest({
  name: 'families-type-test.quotas.claim',
  input: z.object({ tenantId: z.string() }),
  output: z.object({ granted: z.number() }),
});

const PlaceOrder = makeCommand({
  name: 'families-type-test.orders.place',
  input: z.object({ orderId: z.string() }),
});

const OrderPlaced = makeEvent({
  name: 'families-type-test.orders.placed',
  input: z.object({ orderId: z.string() }),
});

const Heartbeat = makeEvent({ name: 'families-type-test.heartbeat' });

/** Словарь сателлита: пересечение словаря ядра со своим полем */
type OutboxEmitMeta<C extends typeof OrderPlaced> = MetaOf<C> & {
  partitionKey?: string;
};

declare const quotas: Port<typeof ClaimQuota>;
declare const placeOrder: Emitter<typeof PlaceOrder>;
declare const orderPlaced: Emitter<typeof OrderPlaced>;
declare const heartbeat: Emitter<typeof Heartbeat>;
declare const outboxed: Emitter<
  typeof OrderPlaced,
  OutboxEmitMeta<typeof OrderPlaced>
>;

/** Ключ идемпотентности есть у обоих видов, уходящих без ответа */
async function keyBelongsToBothEmittingKinds(): Promise<void> {
  await placeOrder.emit({ orderId: 'o-1' }, { idempotencyKey: 'k1' });
  await orderPlaced.emit({ orderId: 'o-1' }, { idempotencyKey: 'k1' });
}

/** У запроса ключа нет: ответа ждёт живой вызывающий */
async function keyIsRejectedForRequest(): Promise<void> {
  // @ts-expect-error: `idempotencyKey` не входит в `meta` вида `request`
  await quotas.call({ tenantId: 't1' }, { idempotencyKey: 'k1' });
}

/** Расширенный словарь принимает своё поле и остаётся типом ядра */
async function satelliteMetaStaysAssignable(): Promise<void> {
  await outboxed.emit({ orderId: 'o-1' }, { partitionKey: 'o-1' });
  await outboxed.emit({ orderId: 'o-1' });

  const asCore: Emitter<typeof OrderPlaced> = outboxed;

  await asCore.emit({ orderId: 'o-1' }, { idempotencyKey: 'k1' });
}

/** Обязательность payload от второго тип-параметра не зависит */
async function payloadRemainsRequired(): Promise<void> {
  await heartbeat.emit();

  // @ts-expect-error: операция со схемой обязана получить payload
  await orderPlaced.emit();

  // @ts-expect-error: расширенный словарь payload не отменяет
  await outboxed.emit();
}
