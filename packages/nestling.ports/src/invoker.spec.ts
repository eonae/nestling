/* eslint-disable unicorn/no-useless-undefined --
 * Реализация контракта без `output` возвращает `undefined` явно: так
 * записан контракт хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { InProcessBus } from './bus.js';
import { makeContract } from './contract.js';
import type { Emitter, Port } from './families.js';
import { implement } from './implement.js';
import type { InvokerContext } from './invoker.js';
import {
  makeLocalEmitter,
  makeLocalPort,
  makeRemoteEmitter,
  makeRemotePort,
} from './invoker.js';
import type { PortFailureInfo } from './runtime.js';
import { PortRuntime } from './runtime.js';

import type { AnyEndpointDefinition } from '@nestling/pipeline';
import { defineFail, Fail, isFail, Ok } from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: (d: { reason: string }) => `Card declined: ${d.reason}`,
  details: z.object({ reason: z.string() }),
});

const ChargeCard = makeContract({
  name: 'invoker.billing.charge',
  kind: 'request',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  errors: [CardDeclined],
});

const OrderPlaced = makeContract({
  name: 'invoker.orders.placed',
  kind: 'event',
  input: z.object({ orderId: z.string() }),
});

/** Что реализация должна сделать с очередным вызовом */
type Behaviour =
  | { kind: 'ok' }
  | { kind: 'declared' }
  | { kind: 'undeclared' }
  | { kind: 'throw' }
  | { kind: 'slow' };

let behaviour: Behaviour = { kind: 'ok' };
let seenSignal: AbortSignal | undefined;

const ChargeCardImpl = implement(ChargeCard, {
  handle: async (input, meta) => {
    seenSignal = meta.signal;

    switch (behaviour.kind) {
      case 'declared': {
        return CardDeclined({ reason: 'insufficient funds' });
      }
      case 'undeclared': {
        return Fail.conflict('someone else charged it') as never;
      }
      case 'throw': {
        throw new Error('internal detail that must not leak');
      }
      case 'slow': {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Ok({ chargeId: 'slow' });
      }
      default: {
        return new Ok({ chargeId: `c-${input.amount}` });
      }
    }
  },
});

const subscribers: string[] = [];

const OrderPlacedBilling = implement(OrderPlaced, {
  subscriber: 'billing',
  handle: async () => {
    subscribers.push('billing');

    return undefined;
  },
});

const OrderPlacedBroken = implement(OrderPlaced, {
  subscriber: 'analytics',
  handle: async () => {
    throw new Error('analytics is broken');
  },
});

interface Harness {
  runtime: PortRuntime;
  failures: PortFailureInfo[];
  bus: InProcessBus;
  close: () => Promise<void>;
}

/** Приложение из одной шины и её маршрутов, доведённое до состояния «WIRE» */
async function harness(
  declarations: readonly AnyEndpointDefinition[],
): Promise<Harness> {
  const failures: PortFailureInfo[] = [];
  const runtime = new PortRuntime((info) => failures.push(info));
  const bus = new InProcessBus({
    onDeliveryFailure: () => {
      /* доставка ломается намеренно: тест смотрит на изоляцию */
    },
  });

  const dispatch = makeDispatch(
    declarations.map((declaration) => declaration.resolve(() => ({}))),
  );

  await bus.serve(dispatch, new AbortController().signal);
  runtime.bind({ dispatch, bus });

  return { runtime, failures, bus, close: () => bus.close() };
}

const portContext = (harnessed: Harness): InvokerContext => ({
  contract: ChargeCard,
  runtime: harnessed.runtime,
  patterns: [ChargeCardImpl.pattern],
});

const emitterContext = (
  harnessed: Harness,
  patterns: readonly string[],
): InvokerContext => ({
  contract: OrderPlaced,
  runtime: harnessed.runtime,
  patterns,
});

describe.each([
  ['local', (h: Harness) => makeLocalPort(portContext(h)) as Port<any>],
  ['remote', (h: Harness) => makeRemotePort(portContext(h)) as Port<any>],
])('%s port', (_name, build) => {
  let harnessed: Harness;
  let port: Port<any>;

  beforeEach(async () => {
    behaviour = { kind: 'ok' };
    harnessed = await harness([ChargeCardImpl]);
    port = build(harnessed);
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('возвращает Ok успешного вызова', async () => {
    const result = await port.call({ amount: 10 });

    expect(result).toBeInstanceOf(Ok);
    expect((result as Ok<{ chargeId: string }>).value).toEqual({
      chargeId: 'c-10',
    });
  });

  it('ре-гидрирует объявленный отказ по коду', async () => {
    behaviour = { kind: 'declared' };

    const result = await port.call({ amount: 10 });

    expect(isFail(result)).toBe(true);
    expect(CardDeclined.is(result)).toBe(true);
    expect((result as { details: { reason: string } }).details).toEqual({
      reason: 'insufficient funds',
    });
  });

  it('незадекларированный отказ становится UnknownError', async () => {
    behaviour = { kind: 'undeclared' };

    const result = await port.call({ amount: 10 });

    expect((result as { code: string }).code).toBe('UNKNOWN');
    expect(harnessed.failures).not.toHaveLength(0);
  });

  it('исключение реализации не выносит наружу ни stack, ни текст', async () => {
    behaviour = { kind: 'throw' };

    const result = await port.call({ amount: 10 });

    expect((result as { code: string }).code).toBe('UNKNOWN');
    expect(JSON.stringify(result)).not.toContain('internal detail');
  });

  it('отвергает невалидный вход, не доходя до реализации', async () => {
    const before = seenSignal;

    const result = await port.call({ amount: 'ten' } as never);

    expect((result as { code: string }).code).toBe('VALIDATION_FAILED');
    expect(seenSignal).toBe(before);
  });

  it('вызов завершается отказом по взведённому сигналу, а не зависает', async () => {
    behaviour = { kind: 'slow' };
    const controller = new AbortController();

    const pending = port.call({ amount: 10 }, { signal: controller.signal });
    controller.abort();

    const result = await pending;

    expect((result as { code: string }).code).toBe('UNKNOWN');
  });

  it('проносит сигнал вызова в meta обработчика', async () => {
    const controller = new AbortController();

    await port.call({ amount: 1 }, { signal: controller.signal });

    expect(seenSignal).toBeDefined();
  });
});

describe('emitter', () => {
  let harnessed: Harness;

  beforeEach(async () => {
    subscribers.length = 0;
    harnessed = await harness([OrderPlacedBilling, OrderPlacedBroken]);
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('local: доставляет всем подписчикам и изолирует отказ одного', async () => {
    const emitter = makeLocalEmitter(
      emitterContext(harnessed, [
        OrderPlacedBilling.pattern,
        OrderPlacedBroken.pattern,
      ]),
    ) as Emitter<any>;

    await expect(emitter.emit({ orderId: 'o-1' })).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(subscribers).toEqual(['billing']);
    expect(harnessed.failures).not.toHaveLength(0);
  });

  it('remote: публикует в шину', async () => {
    const emitter = makeRemoteEmitter(
      emitterContext(harnessed, [
        OrderPlacedBilling.pattern,
        OrderPlacedBroken.pattern,
      ]),
    ) as Emitter<any>;

    await emitter.emit({ orderId: 'o-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(subscribers).toEqual(['billing']);
  });

  it('событие без подписчиков доставляется ноль раз', async () => {
    const emitter = makeLocalEmitter(
      emitterContext(harnessed, []),
    ) as Emitter<any>;

    await expect(emitter.emit({ orderId: 'o-3' })).resolves.toBeUndefined();
    expect(subscribers).toEqual([]);
  });

  it('невалидный payload — бросок, а не тихая недоставка', async () => {
    const emitter = makeLocalEmitter(
      emitterContext(harnessed, [OrderPlacedBilling.pattern]),
    ) as Emitter<any>;

    await expect(emitter.emit({ orderId: 42 } as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('несвязанный рантайм', () => {
  it('вызов до фазы WIRE — ошибка с именем контракта и фазой', async () => {
    const runtime = new PortRuntime(() => {
      /* отказы этого теста не наблюдаются */
    });
    const port = makeLocalPort({
      contract: ChargeCard,
      runtime,
      patterns: [ChargeCardImpl.pattern],
    }) as Port<any>;

    await expect(port.call({ amount: 1 })).rejects.toThrow(
      /'invoker\.billing\.charge' was called before phase 3 WIRE/,
    );
  });
});
