/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`), и `() => {}`
 * ему не соответствует. */
import { implement } from './implement.js';
import { busBindingOf, BusTransport$ } from './transport.js';

import { makeToken } from '@nestling/container';
import { makeEvent, makeRequest } from '@nestling/operations';
import { isEndpointDefinition, Ok } from '@nestling/pipeline';
import { z } from 'zod';

const Ledger = makeToken<{ charge: (amount: number) => string }>('Ledger');

const ChargeCard = makeRequest({
  name: 'impl.billing.charge',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

const OrderPlaced = makeEvent({
  name: 'impl.orders.placed',
  input: z.object({ orderId: z.string() }),
});

/** Операция, доступный и по шине, и по HTTP */
const AddressedBoth = makeRequest({
  name: 'impl.billing.charge.http',
  http: 'POST /charges',
  input: z.object({ amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
});

/** Бросатель `meta.fail`: ни один хендлер этих тестов его не зовёт */
const unusedFail = (): never => {
  throw new Error('meta.fail is not used in these tests');
};

describe('implement', () => {
  it('строит обычную декларацию на транспорте шины', () => {
    const declaration = implement(ChargeCard, {
      handler: async () => new Ok({ chargeId: 'c-1' }),
    });

    expect(isEndpointDefinition(declaration)).toBe(true);
    expect(declaration.transport).toBe(BusTransport$);
    expect(declaration.pattern).toBe('impl.billing.charge');
    expect(declaration.input).toBe(ChargeCard.input);
    expect(declaration.output).toBe(ChargeCard.output);
    expect(busBindingOf(declaration)).toEqual({
      subject: 'impl.billing.charge',
      kind: 'request',
    });
  });

  it('принимает обе формы `handler` и получает их одним `resolve`', async () => {
    const ledger = { charge: (amount: number) => `c-${amount}` };

    const asFunction = implement(ChargeCard, {
      handler: async () => new Ok({ chargeId: 'fn' }),
    });

    class ChargeHandler {
      constructor(private readonly ledger: { charge(a: number): string }) {}

      async handle(input: { amount: number }) {
        return new Ok({ chargeId: this.ledger.charge(input.amount) });
      }
    }

    const asClass = implement(ChargeCard, { handler: ChargeHandler });

    const resolver = (token: unknown): unknown =>
      token === Ledger ? ledger : new ChargeHandler(ledger);

    const meta = { signal: new AbortController().signal, fail: unusedFail };

    await expect(
      asFunction.resolve(resolver).handle({ amount: 1 }, meta),
    ).resolves.toEqual(new Ok({ chargeId: 'fn' }));

    await expect(
      asClass.resolve(resolver).handle({ amount: 3 }, meta),
    ).resolves.toEqual(new Ok({ chargeId: 'c-3' }));
  });

  it('переносит `detached` на декларацию', () => {
    const declaration = implement(ChargeCard, {
      detached: 'внутренний вызов: до auth не доходит',
      handler: async () => new Ok({ chargeId: 'c-1' }),
    });

    expect(declaration.detached).toBe('внутренний вызов: до auth не доходит');
  });

  it('разводит адрес в процессе и адрес на шине для события', () => {
    const billing = implement(OrderPlaced, {
      subscriber: 'billing',
      handler: async () => undefined,
    });

    const analytics = implement(OrderPlaced, {
      subscriber: 'analytics',
      handler: async () => undefined,
    });

    expect(billing.pattern).toBe('impl.orders.placed@billing');
    expect(analytics.pattern).toBe('impl.orders.placed@analytics');
    expect(busBindingOf(billing)?.subject).toBe('impl.orders.placed');
    expect(busBindingOf(analytics)?.subject).toBe('impl.orders.placed');
  });

  it('требует `subscriber` у события — типом и в рантайме', () => {
    expect(() =>
      // @ts-expect-error — у события 0..N подписчиков, и каждый называет себя
      implement(OrderPlaced, {
        handler: async () => undefined,
      }),
    ).toThrow(/'event' operation has 0\.\.N subscribers.*subscriber/s);
  });

  it('запрещает `subscriber` у запроса — типом и в рантайме', () => {
    expect(() =>
      implement(ChargeCard, {
        // @ts-expect-error — у запроса ровно один владелец
        subscriber: 'billing',
        handler: async () => new Ok({ chargeId: 'c-1' }),
      }),
    ).toThrow(/'request' operation has exactly one owner/);
  });

  it('переносит долговечность операции в биндинг реализации', () => {
    const Durable = makeEvent({
      name: 'impl.durable.placed',
      durable: true,
      input: z.object({ id: z.string() }),
    });

    const declaration = implement(Durable, {
      subscriber: 'billing',
      handler: async () => undefined,
    });

    expect(busBindingOf(declaration)?.durable).toBe(true);
  });

  it('биндинг недолговечной операции поля не несёт', () => {
    const declaration = implement(OrderPlaced, {
      subscriber: 'audit',
      handler: async () => undefined,
    });

    expect('durable' in (busBindingOf(declaration) as object)).toBe(false);
  });

  it('запрещает переобъявление интерфейса операции', () => {
    expect(() =>
      implement(ChargeCard, {
        input: z.object({ other: z.string() }) as never,
        handler: async () => new Ok({ chargeId: 'c-1' }),
      }),
    ).toThrow(/'input' belongs to the operation/);
  });

  it('секция http: в реализации по шине не участвует', () => {
    const declaration = implement(AddressedBoth, {
      handler: async () => new Ok({ chargeId: 'c-2' }),
    });

    // Транспорт шины, subject — имя операции: HTTP-адрес на этот путь не
    // влияет никак, он адресует другой транспорт
    expect(declaration.transport).toBe(BusTransport$);
    expect(busBindingOf(declaration)?.subject).toBe(AddressedBoth.name);
    expect(declaration.pattern).toBe(AddressedBoth.name);
    expect(declaration.binding).not.toBe(AddressedBoth.http);
  });
});
