/**
 * Типовые тесты контрактного стаба (стиль — `TYPE-TESTS.md` пайплайна).
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/no-useless-undefined --
 * Фейк `command`/`event`-контракта возвращает `undefined` явно: пустое
 * тело `{}` читалось бы как «забыли дописать». */

import type { EmitDelivery } from './app.js';
import { assembleTest } from './app.js';
import { stub } from './stub.js';

import { makeContract } from '@nestling/contracts';
import { defineFail, Ok } from '@nestling/pipeline';
import type { Port, PortResult } from '@nestling/ports';
import { z } from 'zod';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const QuotaExceeded = defineFail('TYPE_TEST_QUOTA_EXCEEDED', {
  status: 'CONFLICT',
  message: 'Quota exceeded',
});

const ClaimQuota = makeContract({
  name: 'type-test.quotas.claim',
  kind: 'request',
  input: z.object({ tenantId: z.string(), amount: z.number() }),
  output: z.object({ granted: z.number() }),
  errors: [QuotaExceeded],
});

const OrderPlaced = makeContract({
  name: 'type-test.orders.placed',
  kind: 'event',
  input: z.object({ orderId: z.string() }),
});

const PlaceOrder = makeContract({
  name: 'type-test.orders.place',
  kind: 'command',
  input: z.object({ orderId: z.string() }),
});

// ---------------------------------------------------------------------------
// stub: фейк типизирован контрактом
// ---------------------------------------------------------------------------

async function stubAcceptsCompatibleFakes(): Promise<void> {
  await assembleTest({
    stubs: [
      // голое значение — та же форма, что у обычного хендлера
      stub(ClaimQuota, async () => ({ granted: 1 })),
      // `Ok` и объявленный отказ — тоже
      stub(ClaimQuota, async ({ amount }) =>
        amount > 10 ? QuotaExceeded() : new Ok({ granted: amount }),
      ),
      stub(OrderPlaced, () => undefined),
      stub(PlaceOrder, async () => undefined),
    ],
  });
}

async function stubRejectsIncompatibleValue(): Promise<void> {
  await assembleTest({
    // @ts-expect-error: `granted` объявлен числом
    stubs: [stub(ClaimQuota, async () => ({ granted: 'many' }))],
  });
}

async function stubRejectsUndeclaredFail(): Promise<void> {
  const Undeclared = defineFail('TYPE_TEST_UNDECLARED', {
    status: 'NOT_FOUND',
    message: 'Nope',
  });

  await assembleTest({
    // @ts-expect-error: отказа нет в `errors:` контракта
    stubs: [stub(ClaimQuota, async () => Undeclared())],
  });
}

async function stubRejectsEmitterShapeForRequest(): Promise<void> {
  await assembleTest({
    // @ts-expect-error: `request` обязан ответить значением по `output`-схеме
    stubs: [stub(ClaimQuota, async () => undefined)],
  });
}

async function stubRejectsPortShapeForEvent(): Promise<void> {
  await assembleTest({
    // @ts-expect-error: у `event` нет канала результата
    stubs: [stub(OrderPlaced, async () => ({ granted: 1 }))],
  });
}

function stubTypesPayloadByContract(): void {
  stub(ClaimQuota, async (payload) => {
    type _Payload = Expect<
      Equal<typeof payload, { tenantId: string; amount: number }>
    >;

    return { granted: payload.amount };
  });

  // `idempotencyKey` есть только у вида `command`
  stub(PlaceOrder, async (_payload, meta) => {
    type _Key = Expect<Equal<typeof meta.idempotencyKey, string | undefined>>;
  });
}

// ---------------------------------------------------------------------------
// call-site: стаб и боевой порт — один тип
// ---------------------------------------------------------------------------

async function callSiteIsIdentical(): Promise<void> {
  const [, faked] = stub(ClaimQuota, async () => ({ granted: 1 }));

  type _Invoker = Expect<Equal<typeof faked, Port<typeof ClaimQuota>>>;

  const result = await faked.call({ tenantId: 't1', amount: 1 });

  type _Result = Expect<Equal<typeof result, PortResult<typeof ClaimQuota>>>;

  if (!result.isFail) {
    type _Value = Expect<Equal<typeof result.value, { granted: number }>>;
  }
}

// ---------------------------------------------------------------------------
// app.emit: `command`/`event` принимаются, `request` — нет
// ---------------------------------------------------------------------------

async function emitTypes(): Promise<void> {
  const app = await assembleTest({});

  const deliveries = await app.emit(OrderPlaced, { orderId: 'o-1' });

  type _Deliveries = Expect<Equal<typeof deliveries, readonly EmitDelivery[]>>;

  await app.emit(PlaceOrder, { orderId: 'o-1' }, { idempotencyKey: 'k1' });

  // @ts-expect-error: `orderId` объявлен строкой
  await app.emit(OrderPlaced, { orderId: 42 });

  // @ts-expect-error: контракт со схемой обязан получить payload
  await app.emit(OrderPlaced);

  // @ts-expect-error: у `request`-контракта нет подписчиков
  await app.emit(ClaimQuota, { tenantId: 't1', amount: 1 });

  // @ts-expect-error: ключ идемпотентности есть только у вида `command`
  await app.emit(OrderPlaced, { orderId: 'o-1' }, { idempotencyKey: 'k1' });
}
