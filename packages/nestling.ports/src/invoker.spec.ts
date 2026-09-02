/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { InProcessBus } from './bus.js';
import { implement } from './implement.js';
import type { InvokerContext } from './invoker.js';
import {
  makeLocalEmitter,
  makeLocalPort,
  makeRemoteEmitter,
  makeRemotePort,
} from './invoker.js';
import { deadlineIn } from './profile.js';
import type { PortFailureInfo } from './runtime.js';
import { PortRuntime } from './runtime.js';

// Только `jest`: остальные глобали инъектируются раннером, а объект
// `jest` в ESM-режиме — нет
import { jest } from '@jest/globals';
import type { Emitter, Port } from '@nestling/contracts';
import { makeCommand, makeEvent, makeRequest } from '@nestling/contracts';
import type { AnyEndpointDefinition } from '@nestling/pipeline';
import {
  contextVar,
  defineFail,
  Fail,
  isFail,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: (d: { reason: string }) => `Card declined: ${d.reason}`,
  details: z.object({ reason: z.string() }),
});

const ChargeCard = makeRequest({
  name: 'invoker.billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  errors: [CardDeclined],
});

const OrderPlaced = makeEvent({
  name: 'invoker.orders.placed',
  input: z.object({ orderId: z.string() }),
});

const ShipOrder = makeCommand({
  name: 'invoker.orders.ship',
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

/** Ключи идемпотентности, полученные реализацией команды */
const shippedKeys: (string | undefined)[] = [];

const ShipOrderImpl = implement(ShipOrder, {
  // Тот же канал, что и по сети: ключ лежит в транспортных атрибутах
  // рядом с `subject`, и юнит видит его без всякой композиции — на обоих
  // путях биндинга
  pipeline: makePipeline().pre((ctx) => {
    shippedKeys.push(ctx.raw.attributes.idempotencyKey as string | undefined);
  }),
  handle: async () => undefined,
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

const commandContext = (harnessed: Harness): InvokerContext => ({
  contract: ShipOrder,
  runtime: harnessed.runtime,
  patterns: [ShipOrderImpl.pattern],
});

/** Даёт обработчикам, поставленным в очередь, доработать */
const settle = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

  it('восстанавливает объявленный отказ из ответа по коду', async () => {
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

  it('бюджет, исчерпанный к вызову, не трогает ни исполнителя, ни шину', async () => {
    const request = jest.spyOn(harnessed.bus, 'request');
    const before = seenSignal;

    const result = await port.call(
      { amount: 10 },
      { deadline: new Date(Date.now() - 1) },
    );

    expect((result as { code: string }).code).toBe('DEADLINE_EXCEEDED');
    expect((result as { status: string }).status).toBe('TIMEOUT');
    // Ни один из двух исполнителей не тронут: обработчик не видел вызова,
    // шина не получила сообщения
    expect(seenSignal).toBe(before);
    expect(request).not.toHaveBeenCalled();

    request.mockRestore();
  });

  it('обрывает не уложившуюся в бюджет реализацию отказом бюджета', async () => {
    behaviour = { kind: 'slow' };

    const result = await port.call(
      { amount: 10 },
      { deadline: deadlineIn(10) },
    );

    expect((result as { code: string }).code).toBe('DEADLINE_EXCEEDED');
  });

  it('обработчик видит исчерпание бюджета своим сигналом', async () => {
    behaviour = { kind: 'slow' };

    await port.call({ amount: 10 }, { deadline: deadlineIn(10) });

    expect(seenSignal?.aborted).toBe(true);
  });

  it('отмена вызывающим остаётся UnknownError даже при живом бюджете', async () => {
    behaviour = { kind: 'slow' };
    const controller = new AbortController();

    const pending = port.call(
      { amount: 10 },
      // Бюджет заведомо переживёт вызов: оборвать успевает только вызывающий
      { deadline: deadlineIn(10_000), signal: controller.signal },
    );
    controller.abort();

    expect(((await pending) as { code: string }).code).toBe('UNKNOWN');
  });

  it('вызов без бюджета таймера не заводит', async () => {
    const timers = jest.spyOn(globalThis, 'setTimeout');

    await port.call({ amount: 1 });

    expect(timers).not.toHaveBeenCalled();

    timers.mockRestore();
  });
});

describe('идентичность путей биндинга', () => {
  let harnessed: Harness;

  beforeEach(async () => {
    behaviour = { kind: 'slow' };
    harnessed = await harness([ChargeCardImpl]);
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('та же пара «бюджет и медленная реализация» даёт тот же результат', async () => {
    const local = makeLocalPort(portContext(harnessed)) as Port<any>;
    const remote = makeRemotePort(portContext(harnessed)) as Port<any>;

    const results = await Promise.all(
      [local, remote].map((port) =>
        port.call({ amount: 10 }, { deadline: deadlineIn(10) }),
      ),
    );

    expect(results.map((result) => (result as { code: string }).code)).toEqual([
      'DEADLINE_EXCEEDED',
      'DEADLINE_EXCEEDED',
    ]);
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

describe.each([
  [
    'local',
    (h: Harness) => makeLocalEmitter(commandContext(h)) as Emitter<any>,
  ],
  [
    'remote',
    (h: Harness) => makeRemoteEmitter(commandContext(h)) as Emitter<any>,
  ],
])('ключ идемпотентности (%s)', (_name, build) => {
  let harnessed: Harness;
  let emitter: Emitter<any>;

  beforeEach(async () => {
    shippedKeys.length = 0;
    harnessed = await harness([ShipOrderImpl]);
    emitter = build(harnessed);
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('ключ вызывающего передаётся обработчику без подмены', async () => {
    await emitter.emit({ orderId: 'o-1' }, { idempotencyKey: 'order-42' });
    await settle();

    expect(shippedKeys).toEqual(['order-42']);
  });

  it('emit без ключа едет со своим: два вызова — два разных ключа', async () => {
    await emitter.emit({ orderId: 'o-1' });
    await emitter.emit({ orderId: 'o-2' });
    await settle();

    const [first, second] = shippedKeys;

    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect(first).not.toBe(second);
  });

  it('повторный ключ доставляется как обычное сообщение', async () => {
    // Ядро хранилища ключей не тянет: дедупликация — satellite, и ядро
    // гарантирует только провоз ключа
    await emitter.emit({ orderId: 'o-1' }, { idempotencyKey: 'order-42' });
    await emitter.emit({ orderId: 'o-1' }, { idempotencyKey: 'order-42' });
    await settle();

    expect(shippedKeys).toEqual(['order-42', 'order-42']);
  });
});

/**
 * Тип-тесты словаря `meta`: предмет проверки — компилятор, а не рантайм.
 *
 * Функция не вызывается ни разу: `@ts-expect-error` проверяет `tsc`, и
 * исполнять эти вызовы незачем (вызыватели здесь — фикции параметров).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function metaDictionaryTypeTests(
  command: Emitter<typeof ShipOrder>,
  event: Emitter<typeof OrderPlaced>,
  request: Port<typeof ChargeCard>,
): void {
  // Компилируется: идентичность намерения есть у вида `command`
  void command.emit({ orderId: 'o-1' }, { idempotencyKey: 'k' });

  // @ts-expect-error: у вида `event` идентичности намерения нет
  void event.emit({ orderId: 'o-1' }, { idempotencyKey: 'k' });

  // @ts-expect-error: у вида `request` поле не введено (открытый вопрос)
  void request.call({ amount: 1 }, { idempotencyKey: 'k' });

  // Бюджет есть у всех трёх видов — и только моментом
  void command.emit({ orderId: 'o-1' }, { deadline: deadlineIn(10) });
  void event.emit({ orderId: 'o-1' }, { deadline: deadlineIn(10) });
  void request.call({ amount: 1 }, { deadline: deadlineIn(10) });

  // @ts-expect-error: `500` неразличимо читается как epoch и как «через 500 мс»
  void request.call({ amount: 1 }, { deadline: 500 });
}

/**
 * Провоз ambient-контекста: внешний endpoint кладёт переменные в свой
 * input, его обработчик зовёт внутренний порт, а внутренняя реализация
 * смотрит, что до неё дошло.
 *
 * Цепочка настоящая, а не смоделированная: единственный способ получить
 * ячейку запроса у вызывающего — исполнить его через `dispatch`.
 */
const TenantId = contextVar<string>()('tenantId', { propagate: true });
const TraceId = contextVar<string>()('traceId');

const Inner = makeRequest({
  name: 'invoker.propagate.inner',
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

let innerAttributes: Record<string, unknown> = {};
let innerPayload: unknown;

const InnerImpl = implement(Inner, {
  pipeline: makePipeline().pre((ctx) => {
    innerAttributes = ctx.raw.attributes;
    innerPayload = ctx.raw.payload;
  }),
  handle: async () => new Ok({ ok: true }),
});

const Outer = makeRequest({
  name: 'invoker.propagate.outer',
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

let innerPort: Port<any> | undefined;
let innerResult: unknown;
let tenantValue: unknown = 'acme';

const OuterImpl = implement(Outer, {
  pipeline: makePipeline()
    .pre(TenantId.provide(() => tenantValue as string))
    .pre(TraceId.provide(() => 'trace-1')),
  handle: async () => {
    innerResult = await innerPort?.call({ id: 'x' });

    return new Ok({ ok: true });
  },
});

describe.each([
  [
    'local',
    (h: Harness) =>
      makeLocalPort({
        contract: Inner,
        runtime: h.runtime,
        patterns: [InnerImpl.pattern],
      }) as Port<any>,
  ],
  [
    'remote',
    (h: Harness) =>
      makeRemotePort({
        contract: Inner,
        runtime: h.runtime,
        patterns: [InnerImpl.pattern],
      }) as Port<any>,
  ],
])('%s port — провоз контекста', (_name, build) => {
  let harnessed: Harness;
  let outer: Port<any>;

  beforeEach(async () => {
    innerAttributes = {};
    innerPayload = undefined;
    innerResult = undefined;
    tenantValue = 'acme';
    harnessed = await harness([InnerImpl, OuterImpl]);
    innerPort = build(harnessed);
    outer = makeLocalPort({
      contract: Outer,
      runtime: harnessed.runtime,
      patterns: [OuterImpl.pattern],
    }) as Port<any>;
  });

  afterEach(async () => {
    innerPort = undefined;
    await harnessed.close();
  });

  it('провозит объявленную переменную и не провозит остальные', async () => {
    expect(await outer.call({ id: 'o-1' })).toBeInstanceOf(Ok);

    expect(innerAttributes.tenantId).toBe('acme');
    expect(innerAttributes.traceId).toBeUndefined();
  });

  it('не подмешивает провозимое во вход операции', async () => {
    await outer.call({ id: 'o-1' });

    expect(innerPayload).toEqual({ id: 'x' });
  });

  it('вызов вне запроса проходит, провозить просто нечего', async () => {
    expect(await innerPort?.call({ id: 'y' })).toBeInstanceOf(Ok);
    expect(innerAttributes.tenantId).toBeUndefined();
  });

  it('несериализуемое провозимое значение отвергает вызов, называя переменную', async () => {
    tenantValue = (): void => undefined;

    await outer.call({ id: 'o-1' });

    // Вызов внутреннего не состоялся, а вызывающий получил отказ, в тексте
    // которого названа переменная — тот же приём, что у payload'а
    expect(innerAttributes.tenantId).toBeUndefined();
    expect(isFail(innerResult)).toBe(true);
    expect(JSON.stringify(innerResult)).toContain(
      "propagated context variable 'tenantId'",
    );
  });
});

describe('несвязанный рантайм', () => {
  it('вызов до фазы WIRE — ошибка с именем операции и фазой', async () => {
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
