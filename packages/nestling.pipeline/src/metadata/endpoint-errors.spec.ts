/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/consistent-function-scoping --
 * фабрики вызова замыкают фикстуры своего теста */
/**
 * `errors:` в декларации: проверка списка при создании, перенос на
 * значение и вывод множества `E` в хендлер (все три формы `handle`).
 */

import { defineFail, Fail, Ok } from '../core';
import { makePipeline } from '../core/pipeline';

import { makeEndpoint } from './endpoint';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import { z } from 'zod';

/** Токен транспорта фикстур: декларация ссылается на транспорт значением */
const HttpTransport$ = makeToken('transport:http');

const OrderLimitReached = defineFail('ORDER_LIMIT_REACHED', {
  status: 'CONFLICT',
  details: z.object({ limit: z.number() }),
  message: (d) => `Order limit of ${d.limit} reached`,
});

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
});

const OrderOutput = z.object({ id: z.string() });

interface IBilling {
  charge(): Promise<{ id: string }>;
}
const IBillingToken = makeToken<IBilling>('IBilling');

describe('errors: — проверка при создании декларации', () => {
  it('список переносится на значение декларации', () => {
    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'POST /orders',
      errors: [OrderLimitReached, CardDeclined],
      handle: async () => new Ok({ id: '1' }),
    });

    expect(Endpoint.errors).toEqual([OrderLimitReached, CardDeclined]);
  });

  it('список переживает резолв зависимостей', () => {
    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'POST /orders',
      errors: [OrderLimitReached],
      deps: [IBillingToken],
      handle: (billing: IBilling) => async () => new Ok(await billing.charge()),
    });

    const resolved = Endpoint.resolve(() => ({
      charge: async () => ({ id: '1' }),
    }));

    expect(resolved.errors).toEqual([OrderLimitReached]);
  });

  it('не-определение в списке → ошибка с позицией элемента', () => {
    const create = () =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'POST /orders',
        // Класс ошибки — не определение отказа
        errors: [OrderLimitReached, Fail as never],
        handle: async () => new Ok({ id: '1' }),
      });

    expect(create).toThrow(/errors\[1] is not a fail definition/);
    expect(create).toThrow(/POST \/orders/);
  });

  it('дубль кода → ошибка, называющая код', () => {
    const create = () =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'POST /orders',
        errors: [CardDeclined, CardDeclined],
        handle: async () => new Ok({ id: '1' }),
      });

    expect(create).toThrow(/duplicate error code 'CARD_DECLINED'/);
    expect(create).toThrow(/POST \/orders/);
  });

  it('errors не массив → ошибка', () => {
    const create = () =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'POST /orders',
        errors: OrderLimitReached as never,
        handle: async () => new Ok({ id: '1' }),
      });

    expect(create).toThrow(/'errors' must be an array/);
  });
});

// ============================================================================
// Типовые проверки: вывод E во всех трёх формах handle
// ============================================================================

// Форма 1 — голая функция
{
  const Declared = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handle: async () => OrderLimitReached({ limit: 10 }),
  });

  const WithMetaFail = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handle: async (_payload, meta) => {
      meta.fail(OrderLimitReached({ limit: 10 }));
      // Возврат недостижим: `fail` объявлен как `never`
      return new Ok({ id: '1' });
    },
  });

  // @ts-expect-error: CardDeclined не объявлен в errors:
  const Foreign = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handle: async () => CardDeclined(),
  });

  const ForeignInMetaFail = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handle: async (_payload, meta) => {
      // @ts-expect-error: meta.fail сужен до множества errors:
      meta.fail(CardDeclined());
      return new Ok({ id: '1' });
    },
  });

  // @ts-expect-error: без errors: множество пусто — отказ вернуть нельзя
  const NoErrorsDeclared = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    handle: async () => OrderLimitReached({ limit: 10 }),
  });
}

// Форма 2 — каррированная фабрика
{
  const Declared = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [CardDeclined],
    deps: [IBillingToken],
    handle: (billing) => async () => {
      const charged = await billing.charge();
      return charged.id ? new Ok(charged) : CardDeclined();
    },
  });

  const Foreign = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [CardDeclined],
    deps: [IBillingToken],
    // @ts-expect-error: OrderLimitReached не объявлен в errors:
    handle: (billing) => async () => OrderLimitReached({ limit: 10 }),
  });
}

// Форма 3 — класс-хендлер
{
  class DeclaredHandler {
    async handle() {
      return CardDeclined();
    }
  }

  class ForeignHandler {
    async handle() {
      return OrderLimitReached({ limit: 10 });
    }
  }

  const Declared = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [CardDeclined],
    handle: DeclaredHandler,
  });

  const Foreign = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [CardDeclined],
    // @ts-expect-error: OrderLimitReached не объявлен в errors:
    handle: ForeignHandler,
  });
}

// Пайплайн и errors: сочетаются без потери вывода
{
  const WithPipeline = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    pipeline: makePipeline().pre(() => ({ requestId: 'r-1' })),
    errors: [OrderLimitReached],
    handle: async (_payload, meta) => {
      const id: string = meta.requestId;
      return OrderLimitReached({ limit: 10 });
    },
  });
}
