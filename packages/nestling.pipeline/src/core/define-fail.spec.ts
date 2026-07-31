/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable unicorn/consistent-function-scoping --
 * фабрики вызова живут внутри теста: они замыкают его фикстуры */
/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip здесь и есть предмет проверки: structuredClone сохранил бы
 * прототип, а тест ровно про то, что отказ переживает провод без него */
/**
 * `defineFail`: определение как значение, детали по схеме, идентичность
 * по коду и kernel-набор.
 */

import { defineFail, isFailDefinition } from './define-fail';
import {
  DeadlineExceeded,
  isKernelFailCode,
  UnknownError,
  ValidationFailed,
} from './kernel-fails';
import { Fail } from './result';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const OrderNotFound = defineFail('ORDER_NOT_FOUND', {
  status: 'NOT_FOUND',
  details: z.object({ orderId: z.string() }),
  message: (d) => `Order ${d.orderId} not found`,
});

const EmailTaken = defineFail('EMAIL_TAKEN', {
  status: 'CONFLICT',
  message: 'Email already taken',
});

describe('defineFail — конструирование', () => {
  it('со схемой: детали в аргументе, сообщение выводится из них', () => {
    const fail = OrderNotFound({ orderId: '42' });

    expect(fail).toBeInstanceOf(Fail);
    expect(fail.status).toBe('NOT_FOUND');
    expect(fail.code).toBe('ORDER_NOT_FOUND');
    expect(fail.details).toEqual({ orderId: '42' });
    expect(fail.message).toBe('Order 42 not found');
  });

  it('без схемы: конструктор вызывается без аргументов', () => {
    const fail = EmailTaken();

    expect(fail.status).toBe('CONFLICT');
    expect(fail.code).toBe('EMAIL_TAKEN');
    expect(fail.message).toBe('Email already taken');
    expect(fail).not.toHaveProperty('details');
  });

  it('причина передаётся опциями', () => {
    const cause = new Error('db down');

    expect(OrderNotFound({ orderId: '42' }, { cause }).cause).toBe(cause);
    expect(EmailTaken({ cause }).cause).toBe(cause);
  });

  it('определение несёт code, status и схему', () => {
    expect(OrderNotFound.code).toBe('ORDER_NOT_FOUND');
    expect(OrderNotFound.status).toBe('NOT_FOUND');
    expect(OrderNotFound.schema).toBeDefined();
    expect(EmailTaken.schema).toBeUndefined();
  });

  it('создание определения не имеет побочных эффектов', () => {
    // Определение нигде не регистрируется: два одинаковых кода мирно
    // сосуществуют, пока не попали в один список `errors:`.
    const first = defineFail('SAME', { status: 'CONFLICT', message: 'a' });
    const second = defineFail('SAME', { status: 'CONFLICT', message: 'b' });

    expect(first.code).toBe(second.code);
    expect(first().message).toBe('a');
    expect(second().message).toBe('b');
  });
});

describe('defineFail — валидация деталей', () => {
  it('детали не прошли схему → ошибка, называющая код отказа', () => {
    const call = () => (OrderNotFound as unknown as (d: unknown) => Fail)({});

    expect(call).toThrow(/ORDER_NOT_FOUND/);
  });

  it('трансформации схемы применяются: в отказ едет выход схемы', () => {
    const Trimmed = defineFail('TRIMMED', {
      status: 'BAD_REQUEST',
      details: z.object({ name: z.string().trim() }),
      message: (d) => `bad name: ${d.name}`,
    });

    expect(Trimmed({ name: '  Alice  ' }).details).toEqual({ name: 'Alice' });
  });
});

describe('defineFail — идентичность по коду', () => {
  it('is() распознаёт свой отказ и не распознаёт чужой', () => {
    expect(OrderNotFound.is(OrderNotFound({ orderId: '1' }))).toBe(true);
    expect(OrderNotFound.is(EmailTaken())).toBe(false);
    expect(OrderNotFound.is(Fail.notFound('anonymous'))).toBe(false);
    expect(OrderNotFound.is('not a fail')).toBe(false);
    expect(OrderNotFound.is(undefined)).toBe(false);
  });

  it('is() работает на значении без прототипа (JSON round-trip)', () => {
    const wire = JSON.parse(JSON.stringify(OrderNotFound({ orderId: '1' })));

    expect(OrderNotFound.is(wire)).toBe(true);
    expect(wire instanceof Fail).toBe(false);
  });

  it('is() распознаёт код в контексте ответа-ошибки (форма catch-юнита)', () => {
    const response = {
      isSuccess: false as const,
      status: 'NOT_FOUND' as const,
      value: { error: 'Order 1 not found', code: 'ORDER_NOT_FOUND' },
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

describe('kernel-коды', () => {
  it('UnknownError и ValidationFailed — обычные определения ядра', () => {
    expect(UnknownError.code).toBe('UNKNOWN');
    expect(UnknownError.status).toBe('INTERNAL_ERROR');
    expect(ValidationFailed.code).toBe('VALIDATION_FAILED');
    expect(ValidationFailed.status).toBe('BAD_REQUEST');
  });

  it('ValidationFailed принимает issues и проверяет их схемой', () => {
    const fail = ValidationFailed([{ message: 'expected string' }]);
    expect(fail.details).toEqual([{ message: 'expected string' }]);

    expect(() =>
      (ValidationFailed as unknown as (d: unknown) => Fail)('nope'),
    ).toThrow(/VALIDATION_FAILED/);
  });

  it('DeadlineExceeded — определение ядра со статусом TIMEOUT', () => {
    expect(DeadlineExceeded.code).toBe('DEADLINE_EXCEEDED');
    expect(DeadlineExceeded.status).toBe('TIMEOUT');

    // Деталей у него нет: бюджет уже назван статусом и кодом
    expect(DeadlineExceeded.schema).toBeUndefined();
    expect(DeadlineExceeded().details).toBeUndefined();
  });

  it('набор закрыт: пользовательский код в него не входит', () => {
    const Mine = defineFail('MY_CODE', {
      status: 'CONFLICT',
      message: 'mine',
    });

    expect(isKernelFailCode('UNKNOWN')).toBe(true);
    expect(isKernelFailCode('VALIDATION_FAILED')).toBe(true);
    expect(isKernelFailCode('DEADLINE_EXCEEDED')).toBe(true);
    expect(isKernelFailCode(Mine.code)).toBe(false);

    // Пометить своё определение встроенным нечем: публичная поверхность
    // не даёт ни функции регистрации, ни поля в словаре `defineFail`
    const marked = defineFail('MY_KERNEL_CODE', {
      status: 'TIMEOUT',
      message: 'mine',
    });
    expect(isKernelFailCode(marked.code)).toBe(false);

    // Ответ без кода (анонимный отказ) встроенным не считается
    const noCode: string | undefined = undefined;
    expect(isKernelFailCode(noCode)).toBe(false);
  });
});

describe('isFailDefinition', () => {
  it('отличает определение от произвольного значения', () => {
    expect(isFailDefinition(OrderNotFound)).toBe(true);
    expect(isFailDefinition(UnknownError)).toBe(true);
    expect(isFailDefinition(Error)).toBe(false);
    expect(isFailDefinition(Number)).toBe(false);
    expect(isFailDefinition({ code: 'FAKE' })).toBe(false);
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
}
