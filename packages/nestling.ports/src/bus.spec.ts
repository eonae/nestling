/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { InProcessBus } from './bus.js';
import { implement } from './implement.js';

import { makeCommand, makeRequest } from '@nestling/operations';
import { makePipeline, Ok, stream } from '@nestling/pipeline';
import { makeDispatch } from '@nestling/transport';
import { z } from 'zod';

/** Даёт насосам доставки провернуться */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('InProcessBus', () => {
  it('доставляет команду ровно одному члену группы', async () => {
    const bus = new InProcessBus();
    const seen: string[] = [];

    bus.subscribe('bus.command', () => void seen.push('a'), { group: 'owner' });
    bus.subscribe('bus.command', () => void seen.push('b'), { group: 'owner' });

    await bus.publish('bus.command', { id: 1 });
    await settle();

    expect(seen).toHaveLength(1);

    await bus.close();
  });

  it('доставляет событие всем подписчикам', async () => {
    const bus = new InProcessBus();
    const seen: string[] = [];

    bus.subscribe('bus.event', () => void seen.push('billing'), {
      group: 'billing',
    });
    bus.subscribe('bus.event', () => void seen.push('analytics'), {
      group: 'analytics',
    });

    await bus.publish('bus.event', { id: 1 });
    await settle();

    expect(seen.sort()).toEqual(['analytics', 'billing']);

    await bus.close();
  });

  it('изолирует отказ подписчика и отдаёт его диагностическому хуку', async () => {
    const failures: string[] = [];
    const bus = new InProcessBus({
      onDeliveryFailure: ({ subject }) => failures.push(subject),
    });

    const seen: string[] = [];
    bus.subscribe(
      'bus.isolation',
      () => {
        throw new Error('subscriber is broken');
      },
      { group: 'broken' },
    );
    bus.subscribe('bus.isolation', () => void seen.push('healthy'), {
      group: 'healthy',
    });

    await bus.publish('bus.isolation', { id: 1 });
    await settle();

    expect(seen).toEqual(['healthy']);
    expect(failures).toEqual(['bus.isolation']);

    await bus.close();
  });

  it('после закрытия не доставляет ничего', async () => {
    const bus = new InProcessBus({
      onDeliveryFailure: () => {
        /* доставка молчит: тест смотрит на другое */
      },
    });
    const seen: unknown[] = [];

    bus.subscribe('bus.closed', (payload) => void seen.push(payload), {
      group: 'owner',
    });

    await bus.close();
    await bus.publish('bus.closed', { id: 1 });
    await settle();

    expect(seen).toEqual([]);

    const response = await bus.request('bus.closed', { id: 1 });
    expect(response.isSuccess).toBe(false);
  });

  it('не ждёт медленного подписчика на публикации', async () => {
    const bus = new InProcessBus();
    let started = false;

    bus.subscribe(
      'bus.slow',
      async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      { group: 'slow' },
    );

    const before = Date.now();
    await bus.publish('bus.slow', { id: 1 });
    const elapsed = Date.now() - before;

    expect(elapsed).toBeLessThan(40);
    expect(started).toBe(false);

    await settle();
    expect(started).toBe(true);

    await bus.close();
  });

  it('запрос-ответ идёт через барьер и структурную копию', async () => {
    const bus = new InProcessBus();
    let receivedSynchronously = true;
    let received: { items: number[] } | undefined;

    bus.subscribe(
      'bus.request',
      (payload) => {
        received = payload as { items: number[] };

        return {
          isSuccess: true,
          status: 'ok',
          value: { echo: true },
        } as const;
      },
      { group: 'owner' },
    );

    const payload = { items: [1, 2] };
    const pending = bus.request('bus.request', payload);
    receivedSynchronously = received !== undefined;

    const response = await pending;

    expect(receivedSynchronously).toBe(false);
    expect(response).toEqual({
      isSuccess: true,
      status: 'ok',
      value: { echo: true },
    });

    // Копия, а не ссылка: мутация у отправителя получателя не касается
    payload.items.push(3);
    expect(received?.items).toEqual([1, 2]);

    await bus.close();
  });

  it('отвергает несериализуемый payload, называя поле', async () => {
    const bus = new InProcessBus();

    await expect(
      bus.request('bus.unserializable', {
        onDone: (): void => undefined,
      }),
    ).rejects.toThrow(/field 'onDone' cannot be structurally cloned/);

    await bus.close();
  });

  it('запросу без подписчика отвечает отказом', async () => {
    const bus = new InProcessBus({
      onDeliveryFailure: () => {
        /* доставка молчит: тест смотрит на другое */
      },
    });

    const response = await bus.request('bus.orphan', {});

    expect(response.isSuccess).toBe(false);

    await bus.close();
  });

  it('начав принимать запросы, подписывается на subject-ы своих маршрутов', async () => {
    const Ping = makeRequest({
      name: 'bus.serve.ping',
      input: z.object({ value: z.number() }),
      output: z.object({ doubled: z.number() }),
    });

    const declaration = implement(Ping, {
      handler: async (input) => new Ok({ doubled: input.value * 2 }),
    });

    const bus = new InProcessBus();
    const controller = new AbortController();

    await bus.serve(makeDispatch([declaration]), controller.signal);

    const response = await bus.request('bus.serve.ping', { value: 21 });

    expect(response).toMatchObject({ isSuccess: true, value: { doubled: 42 } });

    await bus.close();
  });

  it('пересчитывает относительный timeout в момент по своим часам', async () => {
    const bus = new InProcessBus();
    const seen: (Date | undefined)[] = [];

    bus.subscribe(
      'bus.deadline.request',
      (_payload, meta) => {
        seen.push(meta.deadline);

        return { isSuccess: true, status: 'ok', value: {} } as const;
      },
      { group: 'owner' },
    );

    const before = Date.now();
    await bus.request('bus.deadline.request', {}, { timeoutMs: 500 });

    const [deadline] = seen;
    expect(deadline).toBeInstanceOf(Date);

    // Момент отсчитан от приёма, а не передан отправителем: он лежит
    // в диапазоне [приём, приём + timeoutMs] по часам получателя
    const received = (deadline as Date).getTime();
    expect(received).toBeGreaterThanOrEqual(before);
    expect(received).toBeLessThanOrEqual(Date.now() + 500);

    await bus.close();
  });

  it('вызов без конверта передаётся без профиля — как раньше', async () => {
    const bus = new InProcessBus();
    const seen: unknown[] = [];

    bus.subscribe('bus.envelope.absent', (_payload, meta) => {
      seen.push([meta.deadline, meta.idempotencyKey]);
    });

    await bus.publish('bus.envelope.absent', { id: 1 });
    await settle();

    expect(seen).toEqual([[undefined, undefined]]);

    await bus.close();
  });

  it('провозит ключ идемпотентности до обработчика подписки', async () => {
    const bus = new InProcessBus();
    const seen: (string | undefined)[] = [];

    bus.subscribe('bus.idempotency', (_payload, meta) => {
      seen.push(meta.idempotencyKey);
    });

    await bus.publish(
      'bus.idempotency',
      { id: 1 },
      { idempotencyKey: 'order-42' },
    );
    await settle();

    expect(seen).toEqual(['order-42']);

    await bus.close();
  });

  it("бюджет, исчерпанный в транзите, не доводит сообщение до endpoint'а", async () => {
    const Ping = makeRequest({
      name: 'bus.deadline.ping',
      input: z.object({ value: z.number() }),
      output: z.object({ doubled: z.number() }),
    });

    let executed = false;
    const declaration = implement(Ping, {
      handler: async (input) => {
        executed = true;

        return new Ok({ doubled: input.value * 2 });
      },
    });

    const bus = new InProcessBus();
    await bus.serve(makeDispatch([declaration]), new AbortController().signal);

    // Отрицательный timeout — бюджет, истёкший ещё в транзите
    const response = await bus.request(
      'bus.deadline.ping',
      { value: 21 },
      { timeoutMs: -1 },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'timeout',
      value: { code: 'timeout' },
    });
    expect(executed).toBe(false);

    await bus.close();
  });

  it('кладёт профиль в транспортные атрибуты рядом с subject', async () => {
    const Note = makeCommand({
      name: 'bus.attributes.note',
      input: z.object({ text: z.string() }),
    });

    const seen: Record<string, unknown>[] = [];
    const declaration = implement(Note, {
      pipeline: makePipeline().pre((ctx) => {
        seen.push(ctx.raw.attributes);
      }),
      handler: async () => undefined,
    });

    const bus = new InProcessBus();
    await bus.serve(makeDispatch([declaration]), new AbortController().signal);

    await bus.publish(
      'bus.attributes.note',
      { text: 'hi' },
      { timeoutMs: 1000, idempotencyKey: 'note-1' },
    );
    await settle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      subject: 'bus.attributes.note',
      idempotencyKey: 'note-1',
    });
    expect(seen[0].deadline).toBeInstanceOf(Date);

    await bus.close();
  });

  it('живой бюджет взводит сигнал обработчика', async () => {
    const Slow = makeCommand({
      name: 'bus.deadline.inflight',
      input: z.object({ id: z.number() }),
    });

    let aborted = false;
    const declaration = implement(Slow, {
      handler: async (_input, meta) => {
        await new Promise((resolve) => {
          meta.signal.addEventListener('abort', resolve, { once: true });
        });
        aborted = meta.signal.aborted;

        return undefined;
      },
    });

    const bus = new InProcessBus();
    await bus.serve(makeDispatch([declaration]), new AbortController().signal);

    await bus.publish('bus.deadline.inflight', { id: 1 }, { timeoutMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(aborted).toBe(true);

    await bus.close();
  });

  it('объявляет способности значением: ни remote, ни durable', () => {
    const bus = new InProcessBus();

    expect(bus.remote).toBe(false);
    expect(bus.durable).toBe(false);
  });

  it('провозит контекст конвертом запроса и кладёт его в атрибуты', async () => {
    const Ask = makeRequest({
      name: 'bus.context.ask',
      input: z.object({ id: z.number() }),
      output: z.object({ ok: z.boolean() }),
    });

    const seen: Record<string, unknown>[] = [];
    const payloads: unknown[] = [];
    const declaration = implement(Ask, {
      pipeline: makePipeline().pre((ctx) => {
        seen.push(ctx.raw.attributes);
        payloads.push(ctx.raw.payload);
      }),
      handler: async () => new Ok({ ok: true }),
    });

    const bus = new InProcessBus();
    await bus.serve(makeDispatch([declaration]), new AbortController().signal);

    await bus.request(
      'bus.context.ask',
      { id: 1 },
      { context: { tenantId: 'acme' } },
    );

    expect(seen[0]).toMatchObject({
      subject: 'bus.context.ask',
      tenantId: 'acme',
    });
    // Провоз конвертом, а не подмешиванием во вход
    expect(payloads[0]).toEqual({ id: 1 });

    await bus.close();
  });

  it('провозит контекст конвертом публикации', async () => {
    const bus = new InProcessBus();
    const seen: (Record<string, unknown> | undefined)[] = [];

    bus.subscribe('bus.context.note', (_payload, meta) => {
      seen.push(meta.context);
    });

    await bus.publish(
      'bus.context.note',
      { id: 1 },
      { context: { tenantId: 'acme' } },
    );
    await settle();

    expect(seen).toEqual([{ tenantId: 'acme' }]);

    await bus.close();
  });

  it('копирует провозимый контекст, как копирует payload', async () => {
    const bus = new InProcessBus();
    const seen: (Record<string, unknown> | undefined)[] = [];

    bus.subscribe('bus.context.copy', (_payload, meta) => {
      seen.push(meta.context);
    });

    const context = { tags: ['a'] };
    await bus.publish('bus.context.copy', { id: 1 }, { context });
    context.tags.push('b');
    await settle();

    expect(seen).toEqual([{ tags: ['a'] }]);

    await bus.close();
  });

  it('отвергает несериализуемое провозимое значение', async () => {
    const bus = new InProcessBus();

    await expect(
      bus.request(
        'bus.context.unserializable',
        { id: 1 },
        { context: { onDone: (): void => undefined } },
      ),
    ).rejects.toThrow(
      /Propagated context of 'bus.context.unserializable': field 'onDone'/,
    );

    await bus.close();
  });

  it('без провозимого контекста атрибуты остаются прежними', async () => {
    const bus = new InProcessBus();
    const seen: (Record<string, unknown> | undefined)[] = [];

    bus.subscribe('bus.context.absent', (_payload, meta) => {
      seen.push(meta.context);
    });

    await bus.publish('bus.context.absent', { id: 1 });
    await settle();

    expect(seen).toEqual([undefined]);

    await bus.close();
  });

  it('отвергает потоковую форму существующей проверкой способностей', async () => {
    const Feed = makeRequest({
      name: 'bus.serve.feed',
      output: stream(z.object({ chunk: z.string() })),
    });

    const declaration = implement(Feed, {
      handler: async function* () {
        yield { chunk: 'a' };
      } as never,
    });

    const bus = new InProcessBus();

    await expect(
      bus.serve(makeDispatch([declaration]), new AbortController().signal),
    ).rejects.toThrow(/does not support form 'stream' in 'output'/);

    await bus.close();
  });
});
