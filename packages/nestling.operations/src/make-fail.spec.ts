/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/consistent-function-scoping --
 * фабрики вызова живут внутри теста: они замыкают его фикстуры */
/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip здесь и есть предмет проверки: structuredClone сохранил бы
 * прототип, а тест проверяет, что отказ переживает сериализацию без него */
/**
 * `makeFail`: определение как значение, формат кода, проверка деталей
 * схемой, распознавание по коду и отказы ядра.
 */

import {
  BadRequest,
  InternalError,
  isKernelFailCode,
  PayloadTooLarge,
  Timeout,
} from './kernel-fails.js';
import { isFailDefinition, makeFail } from './make-fail.js';
import { Fail } from './result.js';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const OrderNotFound = makeFail('not_found:order', {
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

const EmailTaken = makeFail('conflict:email_taken', {
  message: 'Email already taken',
});

const Unauthorized = makeFail('unauthorized');

describe('makeFail — конструирование', () => {
  it('со схемой: детали в аргументе, сообщение выводится из них', () => {
    const fail = OrderNotFound({ orderId: '42' });

    expect(fail).toBeInstanceOf(Fail);
    expect(fail.code).toBe('not_found:order');
    expect(fail.category).toBe('not_found');
    expect(fail.details).toEqual({ orderId: '42' });
    expect(fail.message).toBe('Order 42 not found');
  });

  it('без схемы: конструктор вызывается без аргументов', () => {
    const fail = EmailTaken();

    expect(fail.code).toBe('conflict:email_taken');
    expect(fail.category).toBe('conflict');
    expect(fail.message).toBe('Email already taken');
    expect(fail).not.toHaveProperty('details');
  });

  it('код из одной категории: без опций, сообщение равно коду', () => {
    expect(Unauthorized.code).toBe('unauthorized');
    expect(Unauthorized.category).toBe('unauthorized');
    expect(Unauthorized().message).toBe('unauthorized');
  });

  it('причина передаётся опциями', () => {
    const cause = new Error('db down');

    expect(OrderNotFound({ orderId: '42' }, { cause }).cause).toBe(cause);
    expect(EmailTaken({ cause }).cause).toBe(cause);
  });

  it('определение несёт code, category и схему', () => {
    expect(OrderNotFound.code).toBe('not_found:order');
    expect(OrderNotFound.category).toBe('not_found');
    expect(OrderNotFound.schema).toBeDefined();
    expect(EmailTaken.schema).toBeUndefined();
  });

  it('создание определения не имеет побочных эффектов', () => {
    // Определение нигде не регистрируется: два одинаковых кода мирно
    // сосуществуют, пока не попали в один список `errors:`.
    const first = makeFail('conflict:same', { message: 'a' });
    const second = makeFail('conflict:same', { message: 'b' });

    expect(first.code).toBe(second.code);
    expect(first().message).toBe('a');
    expect(second().message).toBe('b');
  });
});

describe('makeFail — формат кода', () => {
  it('сегмент вне алфавита: ошибка называет код и позицию сегмента', () => {
    expect(() =>
      (makeFail as (code: string) => unknown)('not_found:Order-42'),
    ).toThrow(/'not_found:Order-42'.*segment 2 'Order-42'/);
  });

  it('категория вне перечня: ошибка называет категорию', () => {
    expect(() => (makeFail as (code: string) => unknown)('gone:order')).toThrow(
      /'gone', which is not a category/,
    );
  });

  it('пустой код и не строка отвергаются', () => {
    expect(() => (makeFail as (code: unknown) => unknown)('')).toThrow(
      /non-empty string/,
    );
    expect(() => (makeFail as (code: unknown) => unknown)(42)).toThrow(
      /non-empty string/,
    );
  });

  it('категория в сериализованный отказ не попадает', () => {
    const wire = JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })));

    expect(wire.code).toBe('not_found:order');
    expect(wire).not.toHaveProperty('category');
    expect(wire).not.toHaveProperty('status');
  });
});

describe('makeFail — валидация деталей', () => {
  it('детали не прошли схему: ошибка называет код отказа', () => {
    const call = () => (OrderNotFound as unknown as (d: unknown) => Fail)({});

    expect(call).toThrow(/not_found:order/);
  });

  it('трансформации схемы применяются: в отказ попадает выход схемы', () => {
    const Trimmed = makeFail('bad_request:trimmed', {
      details: z.object({ name: z.string().trim() }),
      message: (d) => `bad name: ${d.name}`,
    });

    expect(Trimmed({ name: '  Alice  ' }).details).toEqual({ name: 'Alice' });
  });
});

describe('makeFail — идентичность по коду', () => {
  it('is() распознаёт свой отказ и не распознаёт чужой', () => {
    expect(OrderNotFound.is(OrderNotFound({ orderId: '1' }))).toBe(true);
    expect(OrderNotFound.is(EmailTaken())).toBe(false);
    expect(OrderNotFound.is(Fail.notFound('anonymous'))).toBe(false);
    expect(OrderNotFound.is('not a fail')).toBe(false);
    expect(OrderNotFound.is(undefined)).toBe(false);
  });

  it('категория не является идентичностью', () => {
    const UserNotFound = makeFail('not_found:user');

    expect(OrderNotFound.is(UserNotFound())).toBe(false);
    expect(UserNotFound().category).toBe(OrderNotFound.category);
  });

  it('is() работает на значении без прототипа (JSON round-trip)', () => {
    const wire = JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })));

    expect(OrderNotFound.is(wire)).toBe(true);
    expect(wire instanceof Fail).toBe(false);
  });

  it('is() распознаёт код в контексте ответа-ошибки (форма catch-юнита)', () => {
    const response = {
      isSuccess: false as const,
      status: 'not_found' as const,
      value: { error: 'Order 1 not found', code: 'not_found:order' },
    };

    expect(OrderNotFound.is(response)).toBe(true);
    expect(EmailTaken.is(response)).toBe(false);
  });

  it('сужает тип: внутри ветки доступны details', () => {
    const value: unknown = OrderNotFound({ orderId: '42' });

    if (OrderNotFound.is(value)) {
      expect(value.details.orderId).toBe('42');
    } else {
      throw new Error('предикат обязан был сработать');
    }
  });
});

describe('отказы ядра', () => {
  it('несут голую категорию', () => {
    expect(BadRequest.code).toBe('bad_request');
    expect(PayloadTooLarge.code).toBe('payload_too_large');
    expect(Timeout.code).toBe('timeout');
    expect(InternalError.code).toBe('internal_error');
    expect(InternalError.category).toBe('internal_error');
  });

  it('BadRequest принимает issues и проверяет их схемой', () => {
    const fail = BadRequest([{ message: 'expected string' }]);
    expect(fail.details).toEqual([{ message: 'expected string' }]);

    expect(() =>
      (BadRequest as unknown as (d: unknown) => Fail)('nope'),
    ).toThrow(/bad_request/);
  });

  it('PayloadTooLarge несёт лимит, Timeout и InternalError — без деталей', () => {
    expect(PayloadTooLarge({ limit: 10 }).details).toEqual({ limit: 10 });
    expect(PayloadTooLarge({ limit: 10 }).message).toMatch(/10/);
    expect(Timeout.schema).toBeUndefined();
    expect(Timeout().details).toBeUndefined();
    expect(InternalError().message).toBe('Internal server error');
  });

  it('набор закрыт: пользовательский код с уточнением в него не входит', () => {
    const Mine = makeFail('conflict:mine');

    expect(isKernelFailCode('internal_error')).toBe(true);
    expect(isKernelFailCode('bad_request')).toBe(true);
    expect(isKernelFailCode('timeout')).toBe(true);
    expect(isKernelFailCode('payload_too_large')).toBe(true);
    expect(isKernelFailCode(Mine.code)).toBe(false);
    expect(isKernelFailCode('timeout:mine')).toBe(false);

    // Ответ без кода кодом ядра не считается
    const noCode: string | undefined = undefined;
    expect(isKernelFailCode(noCode)).toBe(false);
  });

  it('пользовательское определение с кодом-категорией — тот же отказ', () => {
    const MyBadRequest = makeFail('bad_request');

    expect(isKernelFailCode(MyBadRequest.code)).toBe(true);
    expect(BadRequest.is(MyBadRequest())).toBe(true);
  });
});

describe('isFailDefinition', () => {
  it('отличает определение от произвольного значения', () => {
    expect(isFailDefinition(OrderNotFound)).toBe(true);
    expect(isFailDefinition(InternalError)).toBe(true);
    expect(isFailDefinition(Error)).toBe(false);
    expect(isFailDefinition(Number)).toBe(false);
    expect(isFailDefinition({ code: 'not_found' })).toBe(false);
  });
});

// ============================================================================
// Типовые проверки
// ============================================================================

// Тип аргумента выводится из схемы, без аннотаций.
// Тело не исполняется: проверка живёт в компиляторе.
function typeChecks(): void {
  // @ts-expect-error: orderId объявлен строкой
  const wrongType = OrderNotFound({ orderId: 42 });
  // @ts-expect-error: определение без схемы деталей не принимает их
  const unexpectedDetails = EmailTaken({ any: 'thing' });
  // @ts-expect-error: первый сегмент не из перечня категорий
  const wrongCategory = makeFail('gone:order');
  // @ts-expect-error: категория обязательна
  const noCategory = makeFail('order');
}
