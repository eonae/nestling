/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/consistent-function-scoping --
 * фабрики вызова замыкают фикстуры своего теста */
/**
 * `errors:` в декларации: проверка списка при создании, перенос на
 * значение и вывод множества `E` в хендлер (обе формы `handler`).
 */

import { Fail, makeFail, Ok } from '../core/index.js';
import { makePipeline } from '../core/pipeline.js';

import { makeEndpoint } from './endpoint.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import { z } from 'zod';

/** Токен транспорта фикстур: декларация ссылается на транспорт значением */
const HttpTransport$ = makeToken('transport:http');

const OrderLimitReached = makeFail('conflict:order_limit_reached', {
  details: z.object({ limit: z.number() }),
  message: (d) => `Order limit of ${d.limit} reached`,
});

const CardDeclined = makeFail('payment_required:card_declined', {
  message: 'Card declined',
});

const OrderOutput = z.object({ id: z.string() });

interface IBilling {
  charge(): Promise<{ id: string }>;
}

describe('errors: — проверка при создании декларации', () => {
  it('список переносится на значение декларации', () => {
    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'POST /orders',
      errors: [OrderLimitReached, CardDeclined],
      handler: async () => new Ok({ id: '1' }),
    });

    expect(Endpoint.errors).toEqual([OrderLimitReached, CardDeclined]);
  });

  it('список переживает получение зависимостей', () => {
    class ChargeHandler {
      constructor(private readonly billing: IBilling) {}

      async handle() {
        return new Ok(await this.billing.charge());
      }
    }

    const Endpoint = makeEndpoint({
      transport: HttpTransport$,
      pattern: 'POST /orders',
      errors: [OrderLimitReached],
      handler: ChargeHandler,
    });

    const resolved = Endpoint.resolve(
      () => new ChargeHandler({ charge: async () => ({ id: '1' }) }),
    );

    expect(resolved.errors).toEqual([OrderLimitReached]);
  });

  it('не-определение в списке → ошибка с позицией элемента', () => {
    const create = () =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'POST /orders',
        // Класс ошибки — не определение отказа
        errors: [OrderLimitReached, Fail as never],
        handler: async () => new Ok({ id: '1' }),
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
        handler: async () => new Ok({ id: '1' }),
      });

    expect(create).toThrow(
      /duplicate error code 'payment_required:card_declined'/,
    );
    expect(create).toThrow(/POST \/orders/);
  });

  it('errors не массив → ошибка', () => {
    const create = () =>
      makeEndpoint({
        transport: HttpTransport$,
        pattern: 'POST /orders',
        errors: OrderLimitReached as never,
        handler: async () => new Ok({ id: '1' }),
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
    handler: async () => OrderLimitReached({ limit: 10 }),
  });

  const NoMetaFail = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handler: async (_payload, meta) => {
      // @ts-expect-error: в meta нет fail — канон доставки отказа это return
      meta.fail(OrderLimitReached({ limit: 10 }));
      return new Ok({ id: '1' });
    },
  });

  // @ts-expect-error: CardDeclined не объявлен в errors:
  const Foreign = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [OrderLimitReached],
    handler: async () => CardDeclined(),
  });

  // @ts-expect-error: без errors: множество пусто — отказ вернуть нельзя
  const NoErrorsDeclared = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    handler: async () => OrderLimitReached({ limit: 10 }),
  });
}

// Форма 2 — класс-хендлер
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
    handler: DeclaredHandler,
  });

  const Foreign = makeEndpoint({
    transport: HttpTransport$,
    pattern: 'POST /orders',
    output: OrderOutput,
    errors: [CardDeclined],
    // @ts-expect-error: OrderLimitReached не объявлен в errors:
    handler: ForeignHandler,
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
    handler: async (_payload, meta) => {
      const id: string = meta.requestId;
      return OrderLimitReached({ limit: 10 });
    },
  });
}
