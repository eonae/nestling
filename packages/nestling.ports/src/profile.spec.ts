/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
/**
 * Эксплуатационный профиль: помощники бюджета и оба канала его доставки.
 *
 * Канал транспортных атрибутов (`raw.attributes`) проверяется тестами
 * вызывателей и шины; здесь — проекция для кода произвольной глубины:
 * ambient-переменные, их штатные писатели, policy-check присутствия и
 * явная передача остатка вложенному вызову.
 */

import { InProcessBus } from './bus.js';
import { implement } from './implement.js';
import { makeLocalEmitter, makeLocalPort } from './invoker.js';
import {
  Deadline,
  deadlineFromTimeout,
  deadlineIn,
  IdempotencyKey,
  isExhausted,
  profileAttributes,
  remainingMs,
  startBudget,
  withDeadline,
  withIdempotencyKey,
} from './profile.js';
import { PortRuntime } from './runtime.js';
import { BusTransport$ } from './transport.js';

import { ContainerBuilder, makeToken } from '@nestling/container';
import type { Emitter, Port } from '@nestling/operations';
import { makeCommand, makeRequest } from '@nestling/operations';
import type {
  AnyEndpointDefinition,
  AnyInput,
  CtxReader,
  ExtendableContext,
} from '@nestling/pipeline';
import {
  contextKernel,
  Ctx,
  everyEndpoint,
  makeEmptyContext,
  makePipeline,
  Ok,
} from '@nestling/pipeline';
import type { Dispatch } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Субъект политики: та же форма, в какой его отдаёт discovery */
const subject = (
  endpoint: AnyEndpointDefinition,
): { endpoint: AnyEndpointDefinition; moduleName: string } => ({
  endpoint,
  moduleName: 'module:orders',
});

/**
 * Ридеры из настоящего графа: модуль контекста из ядра регистрируется
 * корнем, поэтому и в тесте они приходят тем же путём, а не фейком.
 */
async function contextReaders(): Promise<{
  deadline: CtxReader<Date | undefined>;
  key: CtxReader<string>;
}> {
  const builder = new ContainerBuilder();
  builder.register(contextKernel());
  builder.register({
    provide: makeToken('probe'),
    useFactory: (...args: unknown[]) => args,
    deps: [Ctx(Deadline), Ctx(IdempotencyKey)],
  });

  const container = await builder.build();

  return {
    deadline: container.getOrThrow(Ctx(Deadline)),
    key: container.getOrThrow(Ctx(IdempotencyKey)),
  };
}

/** Приложение из одной шины и её маршрутов, доведённое до состояния «WIRE» */
async function harness(
  declarations: readonly AnyEndpointDefinition[],
): Promise<{
  runtime: PortRuntime;
  dispatch: Dispatch;
  close: () => Promise<void>;
}> {
  const runtime = new PortRuntime(() => {
    /* отказы этих тестов наблюдаются напрямую */
  });
  const bus = new InProcessBus();
  const dispatch = makeDispatch(
    declarations.map((declaration) => declaration.resolve(() => ({}))),
  );

  await bus.serve(dispatch, new AbortController().signal);
  runtime.bind({ dispatch, bus });

  return { runtime, dispatch, close: () => bus.close() };
}

describe('помощники бюджета', () => {
  it('deadlineIn даёт момент, отсчитанный от собственных часов', () => {
    const before = Date.now();
    const moment = deadlineIn(500);

    expect(moment).toBeInstanceOf(Date);
    expect(moment.getTime()).toBeGreaterThanOrEqual(before + 500);
    expect(moment.getTime()).toBeLessThanOrEqual(Date.now() + 500);
  });

  it('остатка нет там, где нет бюджета', () => {
    expect(remainingMs()).toBeUndefined();
    expect(isExhausted()).toBe(false);
    expect(deadlineFromTimeout()).toBeUndefined();
  });

  it('исчерпанным считается непросроченный бюджет с нулевым остатком', () => {
    expect(isExhausted(new Date(Date.now() - 1))).toBe(true);
    expect(isExhausted(new Date(Date.now() + 10_000))).toBe(false);
  });

  it('приём превращает относительный timeout в момент по своим часам', () => {
    const before = Date.now();
    const moment = deadlineFromTimeout(500) as Date;

    expect(moment.getTime()).toBeGreaterThanOrEqual(before + 500);
    expect(moment.getTime()).toBeLessThanOrEqual(Date.now() + 500);
  });

  it('атрибуты не заводят ключей, которых не было в конверте', () => {
    expect(profileAttributes({ subject: 's' })).toEqual({ subject: 's' });
    expect(
      profileAttributes({ subject: 's', idempotencyKey: 'k' }),
    ).toStrictEqual({ subject: 's', idempotencyKey: 'k' });
  });

  it('без бюджета сигнал вызывающего передаётся как есть, без композиции', () => {
    const caller = new AbortController().signal;
    const budget = startBudget(undefined, caller);

    expect(budget.signal).toBe(caller);
    expect(budget.expired).toBe(false);
  });

  it('собственный таймер бюджета помечает вызов истёкшим', async () => {
    const budget = startBudget(deadlineIn(5));

    expect(budget.expired).toBe(false);
    await sleep(20);

    expect(budget.signal.aborted).toBe(true);
    expect(budget.expired).toBe(true);
    budget.release();
  });

  it('отмена вызывающим не выдаёт себя за исчерпание бюджета', async () => {
    const controller = new AbortController();
    const budget = startBudget(deadlineIn(5), controller.signal);

    controller.abort();
    await sleep(20);

    // Таймер тоже сработал, но «выиграл» вызывающий: его отмена остаётся
    // `UnknownError`, какой была до появления бюджета
    expect(budget.expired).toBe(false);
    budget.release();
  });
});

describe('Deadline — чтение бюджета из глубины', () => {
  const Charge = makeRequest({
    name: 'profile.billing.charge',
    input: z.object({ amount: z.number() }),
    output: z.object({ seen: z.boolean() }),
  });

  let reader: CtxReader<Date | undefined>;
  let seen: Date | undefined;

  const ChargeImpl = implement(Charge, {
    pipeline: makePipeline().pre(withDeadline()),
    handle: async () => {
      seen = reader.peek();

      return new Ok({ seen: seen !== undefined });
    },
  });

  let harnessed: Awaited<ReturnType<typeof harness>>;
  let port: Port<any>;

  beforeEach(async () => {
    seen = undefined;
    ({ deadline: reader } = await contextReaders());
    harnessed = await harness([ChargeImpl]);
    port = makeLocalPort({
      operation: Charge,
      runtime: harnessed.runtime,
      patterns: [ChargeImpl.pattern],
    }) as Port<any>;
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('peek() даёт момент, с которым пришёл вызов', async () => {
    const moment = deadlineIn(500);

    await port.call({ amount: 1 }, { deadline: moment });

    expect(seen).toEqual(moment);
  });

  it('у вызова без бюджета значения нет', async () => {
    await port.call({ amount: 1 });

    expect(seen).toBeUndefined();
  });

  it('без писателя в пайплайне переменной не существует вовсе', async () => {
    const Bare = makeRequest({
      name: 'profile.billing.bare',
      input: z.object({ amount: z.number() }),
      output: z.object({ ok: z.boolean() }),
    });

    let thrown: unknown;
    const BareImpl = implement(Bare, {
      handle: async () => {
        try {
          reader.get();
        } catch (error) {
          thrown = error;
        }

        return new Ok({ ok: true });
      },
    });

    const bare = await harness([BareImpl]);
    const barePort = makeLocalPort({
      operation: Bare,
      runtime: bare.runtime,
      patterns: [BareImpl.pattern],
    }) as Port<any>;

    await barePort.call({ amount: 1 }, { deadline: deadlineIn(500) });

    // Бюджет передан транспортными атрибутами, но проекции без писателя
    // нет: диагностика называет починку — композировать слой и объявить
    // инвариант
    expect((thrown as Error).message).toMatch(/<Var>\.provide/);
    expect((thrown as Error).message).toMatch(/hasVar/);

    await bare.close();
  });
});

describe('IdempotencyKey — чтение ключа из глубины', () => {
  const Ship = makeCommand({
    name: 'profile.orders.ship',
    input: z.object({ orderId: z.string() }),
  });

  let reader: CtxReader<string>;
  let seen: string | undefined;

  const ShipImpl = implement(Ship, {
    pipeline: makePipeline().pre(withIdempotencyKey()),
    handle: async () => {
      seen = reader.get();

      return undefined;
    },
  });

  let harnessed: Awaited<ReturnType<typeof harness>>;
  let emitter: Emitter<any>;

  beforeEach(async () => {
    seen = undefined;
    ({ key: reader } = await contextReaders());
    harnessed = await harness([ShipImpl]);
    emitter = makeLocalEmitter({
      operation: Ship,
      runtime: harnessed.runtime,
      patterns: [ShipImpl.pattern],
    }) as Emitter<any>;
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('get() даёт ключ доставленной команды', async () => {
    await emitter.emit({ orderId: 'o-1' }, { idempotencyKey: 'order-42' });
    await sleep(0);

    expect(seen).toBe('order-42');
  });

  it('команда без ключа получает ключ, сгенерированный вызывателем', async () => {
    await emitter.emit({ orderId: 'o-1' });
    await sleep(0);

    expect(typeof seen).toBe('string');
  });
});

describe('policy-check присутствия переменной', () => {
  const Ship = makeCommand({
    name: 'profile.policy.ship',
    input: z.object({ orderId: z.string() }),
  });

  const policy = everyEndpoint({ transport: BusTransport$ }).hasVar(
    IdempotencyKey,
    'idempotencyKey',
  );

  it('реализация со штатным писателем инвариант соблюдает', () => {
    const withKey = implement(Ship, {
      pipeline: makePipeline().pre(withIdempotencyKey()),
      handle: async () => undefined,
    });

    expect(policy.check([subject(withKey)])).toEqual([]);
  });

  it('реализация без слоя падает на сборке с координатами и починкой', () => {
    const Bare = makeCommand({
      name: 'profile.policy.bare',
      input: z.object({ orderId: z.string() }),
    });

    const bare = implement(Bare, { handle: async () => undefined });
    const [violation] = policy.check([subject(bare)]);

    expect(violation.pattern).toBe('profile.policy.bare');
    expect(violation.detail).toContain("context variable 'idempotencyKey'");
  });
});

describe('явная передача остатка вглубь', () => {
  const Inner = makeRequest({
    name: 'profile.nested.inner',
    input: z.object({ id: z.string() }),
    output: z.object({ done: z.boolean() }),
  });

  const Outer = makeRequest({
    name: 'profile.nested.outer',
    input: z.object({ id: z.string() }),
    output: z.object({ ok: z.boolean() }),
  });

  const InnerImpl = implement(Inner, {
    handle: async () => {
      await sleep(80);

      return new Ok({ done: true });
    },
  });

  let reader: CtxReader<Date | undefined>;
  let inner: Port<any>;
  let forward = false;
  let innerResult: unknown;

  const OuterImpl = implement(Outer, {
    pipeline: makePipeline().pre(withDeadline()),
    handle: async () => {
      innerResult = await inner.call(
        { id: 'i-1' },
        // Остаток общего бюджета отдаётся дальше **явно**: неявного
        // наследования нет — ровно как его нет у `signal`
        forward ? { deadline: reader.peek() } : undefined,
      );

      return new Ok({ ok: true });
    },
  });

  let harnessed: Awaited<ReturnType<typeof harness>>;

  /** Кадр запроса, который построил бы вызыватель порта с бюджетом */
  const frameWithBudget = (deadline: Date): ExtendableContext<AnyInput> =>
    makeEmptyContext(
      {
        transport: 'bus',
        pattern: OuterImpl.pattern,
        payload: { id: 'o-1' },
        attributes: profileAttributes({ subject: Outer.name, deadline }),
      },
      { transport: 'bus', pattern: OuterImpl.pattern },
    );

  beforeEach(async () => {
    innerResult = undefined;
    ({ deadline: reader } = await contextReaders());
    harnessed = await harness([InnerImpl, OuterImpl]);
    inner = makeLocalPort({
      operation: Inner,
      runtime: harnessed.runtime,
      patterns: [InnerImpl.pattern],
    }) as Port<any>;
  });

  afterEach(async () => {
    await harnessed.close();
  });

  it('переданный остаток ограничивает вложенный вызов', async () => {
    forward = true;

    await harnessed.dispatch.call(
      OuterImpl.pattern,
      frameWithBudget(deadlineIn(30)),
    );

    expect((innerResult as { code: string }).code).toBe('DEADLINE_EXCEEDED');
  });

  it('без явной передачи вложенный вызов бюджета не наследует', async () => {
    forward = false;

    await harnessed.dispatch.call(
      OuterImpl.pattern,
      frameWithBudget(deadlineIn(30)),
    );

    expect(innerResult).toBeInstanceOf(Ok);
  });
});
