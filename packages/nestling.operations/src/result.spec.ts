/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip — предмет проверки: structuredClone сохранил бы прототип */
/**
 * `Ok` и `Fail` как значения: дискриминант, `code`/`category`/`cause`,
 * несовместимость отказов с разными кодами и запрет `new Ok(fail)`.
 *
 * Типовые проверки живут здесь же, рядом с рантайм-ожиданиями: обе
 * стороны описывают одну и ту же форму значения.
 */

import { makeFail } from './make-fail.js';
import type { Output, OutputSync } from './output.js';
import type { AnyFail } from './result.js';
import { Fail, isFail, Ok } from './result.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const OrderNotFound = makeFail('not_found:order', {
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

const CardDeclined = makeFail('payment_required:card_declined', {
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
      expect(res.code).toBe('not_found:order');
      expect(res.details.orderId).toBe('42');
    } else {
      expect(res.value.id).toBeDefined();
    }
  });
});

describe('Ok — статусы успеха', () => {
  it('статус по умолчанию — ok, фабрики дают остальные', () => {
    expect(new Ok({ id: 1 }).status).toBe('ok');
    expect(Ok.created({ id: 1 }).status).toBe('created');
    expect(Ok.accepted({ id: 1 }).status).toBe('accepted');
    expect(Ok.noContent().status).toBe('no_content');
    expect(Ok.noContent().value).toBeNull();
  });

  it('заголовки — метаданные ответа, транспорт им не назначен', () => {
    const ok = Ok.created({ id: 1 }, { Location: '/orders/1' });

    expect(ok.headers).toEqual({ Location: '/orders/1' });
    expect(
      new Ok('accepted', { id: 1 }, { 'Retry-After': '5' }).headers,
    ).toEqual({ 'Retry-After': '5' });
  });
});

describe('Fail — code, category и cause', () => {
  it('cause доступен на значении и не является частью деталей', () => {
    const cause = new Error('connection refused');
    const fail = OrderNotFound({ orderId: '42' }, { cause });

    expect(fail.cause).toBe(cause);
    expect(fail.details).toEqual({ orderId: '42' });
  });

  it('категория выводится из кода', () => {
    expect(new Fail('not_found:order', 'nope').category).toBe('not_found');
    expect(new Fail('conflict', 'dup').category).toBe('conflict');
  });

  it('анонимные фабрики дают отказ с кодом, равным категории', () => {
    const fail = Fail.notFound('nope');

    expect(fail.code).toBe('not_found');
    expect(fail.category).toBe('not_found');
    expect(fail.isFail).toBe(true);
    expect(Fail.conflict('dup').code).toBe('conflict');
    expect(Fail.tooManyRequests('slow down').code).toBe('too_many_requests');
    expect(Fail.timeout('too slow').code).toBe('timeout');
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
  // @ts-expect-error: Fail<'not_found:order'> не присваивается Fail<'payment_required:card_declined'>
  const declined: ReturnType<typeof CardDeclined> = notFound;
}

// Анонимный отказ не выдаёт себя за объявленный
{
  // @ts-expect-error: Fail<'not_found'> не присваивается Fail<'not_found:order'>
  const declared: ReturnType<typeof OrderNotFound> = Fail.notFound('nope');
}

// `new Ok(fail)` — ошибка компиляции
{
  // @ts-expect-error: Ok не оборачивает отказ
  const wrapped = new Ok(OrderNotFound({ orderId: '1' }));
  // @ts-expect-error: то же в форме со статусом
  const wrappedWithStatus = new Ok('created', CardDeclined());
}

// Output без объявленных отказов не принимает Fail
{
  const okOnly: OutputSync<Order> = new Ok({ id: '1' });
  const bare: OutputSync<Order> = { id: '1' };
  // @ts-expect-error: E по умолчанию пусто — вернуть отказ нельзя
  const failing: OutputSync<Order> = OrderNotFound({ orderId: '1' });
}

// Output принимает определения и разворачивает их в отказы
{
  const declared: OutputSync<Order, typeof OrderNotFound> = OrderNotFound({
    orderId: '1',
  });
  // @ts-expect-error: чужой отказ вне множества E
  const foreign: OutputSync<Order, typeof OrderNotFound> = CardDeclined();

  const either: OutputSync<Order, typeof OrderNotFound | typeof CardDeclined> =
    CardDeclined();

  const asyncDeclared: Output<Order, typeof OrderNotFound> = Promise.resolve(
    OrderNotFound({ orderId: '1' }),
  );
}

// Output принимает и готовые типы отказов
{
  type Declared = ReturnType<typeof OrderNotFound>;

  const declared: OutputSync<Order, Declared> = OrderNotFound({ orderId: '1' });
  // @ts-expect-error: чужой отказ вне множества E
  const foreign: OutputSync<Order, Declared> = CardDeclined();
}

// AnyFail покрывает любой отказ — им ограничивается E
{
  const anonymous: AnyFail = Fail.notFound('nope');
  const declared: AnyFail = OrderNotFound({ orderId: '1' });
}
