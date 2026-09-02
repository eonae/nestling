/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip — предмет проверки: structuredClone сохранил бы прототип */
/**
 * `Ok` и `Fail` как значения: дискриминант, `code`/`cause`,
 * несовместимость отказов с разными кодами и запрет `new Ok(fail)`.
 *
 * Типовые проверки живут здесь же, рядом с рантайм-ожиданиями: обе
 * стороны описывают одну и ту же форму значения.
 */

import { defineFail } from './define-fail.js';
import type { AnyFail, Output, OutputSync } from './result.js';
import { Fail, isFail, Ok } from './result.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
});

describe('Ok/Fail — дискриминант isFail', () => {
  it('Ok несёт false, Fail — true', () => {
    expect(new Ok({ id: 1 }).isFail).toBe(false);
    expect(OrderNotFound({ orderId: '42' }).isFail).toBe(true);
  });

  it('дискриминант переживает сериализацию, instanceof — нет', () => {
    const wire = JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })));

    expect(wire.isFail).toBe(true);
    expect(wire instanceof Fail).toBe(false);
    expect(isFail(wire)).toBe(true);
  });

  it('сужает тип без приведения', () => {
    const res = OrderNotFound({ orderId: '42' }) as
      | Ok<{ id: string }>
      | ReturnType<typeof OrderNotFound>;

    if (res.isFail) {
      // В этой ветке доступны поля отказа
      expect(res.code).toBe('ORDER_NOT_FOUND');
      expect(res.details.orderId).toBe('42');
    } else {
      expect(res.value.id).toBeDefined();
    }
  });
});

describe('Fail — code и cause', () => {
  it('cause доступен на значении и не является частью деталей', () => {
    const cause = new Error('connection refused');
    const fail = OrderNotFound({ orderId: '42' }, { cause });

    expect(fail.cause).toBe(cause);
    expect(fail.details).toEqual({ orderId: '42' });
  });

  it('статические фабрики дают анонимный отказ (code: undefined)', () => {
    const fail = Fail.notFound('nope');

    expect(fail.code).toBeUndefined();
    expect(fail.status).toBe('NOT_FOUND');
    expect(fail.isFail).toBe(true);
  });

  it('новые статусы словаря доступны фабриками', () => {
    expect(Fail.conflict('dup').status).toBe('CONFLICT');
    expect(Fail.tooManyRequests('slow down').status).toBe('TOO_MANY_REQUESTS');
    expect(Fail.timeout('too slow').status).toBe('TIMEOUT');
  });
});

// ============================================================================
// Типовые проверки
// ============================================================================

interface Order {
  id: string;
}

// Отказы с разными кодами несовместимы по присваиванию
{
  const notFound = OrderNotFound({ orderId: '1' });
  // @ts-expect-error: Fail<'ORDER_NOT_FOUND'> не присваивается Fail<'CARD_DECLINED'>
  const declined: ReturnType<typeof CardDeclined> = notFound;
}

// Анонимный отказ не выдаёт себя за объявленный
{
  // @ts-expect-error: Fail<undefined> не присваивается Fail<'ORDER_NOT_FOUND'>
  const declared: ReturnType<typeof OrderNotFound> = Fail.notFound('nope');
}

// `new Ok(fail)` — ошибка компиляции
{
  // @ts-expect-error: Ok не оборачивает отказ
  const wrapped = new Ok(OrderNotFound({ orderId: '1' }));
  // @ts-expect-error: то же в форме со статусом
  const wrappedWithStatus = new Ok('CREATED', CardDeclined());
}

// Output без объявленных отказов не принимает Fail
{
  const okOnly: OutputSync<Order> = new Ok({ id: '1' });
  const bare: OutputSync<Order> = { id: '1' };
  // @ts-expect-error: E по умолчанию пусто — вернуть отказ нельзя
  const failing: OutputSync<Order> = OrderNotFound({ orderId: '1' });
}

// Output с объявленным множеством принимает только его члены
{
  type Declared = ReturnType<typeof OrderNotFound>;

  const declared: OutputSync<Order, Declared> = OrderNotFound({ orderId: '1' });
  // @ts-expect-error: чужой отказ вне множества E
  const foreign: OutputSync<Order, Declared> = CardDeclined();

  const asyncDeclared: Output<Order, Declared> = Promise.resolve(
    OrderNotFound({ orderId: '1' }),
  );
}

// AnyFail покрывает любой отказ — им ограничивается E
{
  const anonymous: AnyFail = Fail.notFound('nope');
  const declared: AnyFail = OrderNotFound({ orderId: '1' });
}
