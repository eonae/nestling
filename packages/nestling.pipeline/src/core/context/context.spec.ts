/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions --
 * блок типовых проверок объявляет имена и трогает поля ради компилятора,
 * не ради рантайма */
/**
 * Переменные и ридеры ambient-контекста.
 *
 * Проверяется поверхность в изоляции от пайплайна: объявление и его
 * fail-fast'ы, форма писателя, зеркало `get()`/`peek()` и три текста
 * диагностики — каждый обязан называть починку, иначе он бесполезен.
 */

import type { PreUnitFn } from '../types/unit.js';

import type { CtxReader } from './reader.js';
import { ContextVarUnavailableError, Ctx, makeCtxReader } from './reader.js';
import type { ContextPhase } from './store.js';
import { makeCell, runInScope } from './store.js';
import { contextVar, declaredVarOf } from './variable.js';
import { RequestId, Signal } from './well-known.js';

import { describe, expect, it } from '@jest/globals';
import type { Token } from '@nestling/container';
import type { AnyInput, EmptyInput } from '@nestling/operations';

/** Проверка типов: `Expect<Equal<A, B>>` */
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const NEVER_ABORTED = new AbortController().signal;

/** Исполняет `fn` под ячейкой запроса с заданной проекцией */
const inScope = <R>(
  input: AnyInput,
  fn: () => R,
  phase: ContextPhase = 'handler',
): R => runInScope(makeCell(NEVER_ABORTED, input, phase), fn);

describe('contextVar — объявление переменной', () => {
  it('несёт ключ и типизирует ридер', () => {
    const TenantId = contextVar<string>()('tenantId');

    expect(TenantId.key).toBe('tenantId');
    expect(Ctx(TenantId).id).toBe('Ctx:tenantId');

    type _Reader = Expect<
      Equal<
        ReturnType<typeof Ctx<string>> extends Token<CtxReader<string>>
          ? true
          : false,
        true
      >
    >;
  });

  it('одноимённые переменные — разные значения, но один токен ридера', () => {
    const first = contextVar<string>()('requestId');
    const second = contextVar<string>()('requestId');

    expect(first).not.toBe(second);
    expect(Ctx(first)).toBe(Ctx(second));
  });

  it('отвергает пустой, пробельный и не-строковый ключ', () => {
    expect(() => contextVar<string>()('')).toThrow(/non-empty/);
    expect(() => contextVar<string>()('  ')).toThrow(/non-empty/);
    expect(() =>
      (contextVar<string>() as (key: unknown) => unknown)(42),
    ).toThrow(TypeError);
  });

  it("ключ 'signal' зарезервирован и отсылает к готовой переменной", () => {
    expect(() => contextVar<AbortSignal>()('signal')).toThrow(/Signal/);
  });

  it('однократный вызов с ключом — ошибка с указанием формы', () => {
    // JS-потребитель типами не сдержан: `contextVar('requestId')` обязан
    // падать понятным текстом, а не возвращать функцию
    expect(() => (contextVar as (key: string) => unknown)('requestId')).toThrow(
      /takes no arguments/,
    );
  });
});

describe('Var.provide — единственный канонический писатель', () => {
  it('строит добавку из своего ключа', async () => {
    const TenantId = contextVar<string>()('tenantId');
    const unit = TenantId.provide(() => 'acme');

    await expect(unit({} as never)).resolves.toEqual({ tenantId: 'acme' });
  });

  it('помечает юнит переменной — неперечислимо', () => {
    const TenantId = contextVar<string>()('tenantId');
    const unit = TenantId.provide(() => 'acme');

    expect(declaredVarOf(unit)).toBe(TenantId);
    expect(Object.keys(unit)).toEqual([]);
    expect({ ...unit }).toEqual({});
  });

  it('юнит, кладущий поле вручную, объявителем не считается', () => {
    expect(declaredVarOf(async () => ({ tenantId: 'acme' }))).toBeUndefined();
    expect(declaredVarOf('not a unit')).toBeUndefined();
  });

  it('Signal писать нечем — ни типом, ни в рантайме', () => {
    // @ts-expect-error: у read-only переменной нет provide
    Signal.provide;

    expect(() =>
      (Signal as unknown as { provide: () => void }).provide(),
    ).toThrow(/read-only/);
  });
});

describe('CtxReader — get() и peek()', () => {
  const reader = makeCtxReader('requestId') as CtxReader<string>;

  it('вне scope: peek() — undefined, get() — про фоновый путь', () => {
    expect(reader.peek()).toBeUndefined();
    expect(() => reader.get()).toThrow(ContextVarUnavailableError);
    expect(() => reader.get()).toThrow(/no request context/);
    expect(() => reader.get()).toThrow(/peek\(\)/);
  });

  it('переменная в проекции: get() и peek() дают одно значение', () => {
    inScope({ requestId: 'req-1' }, () => {
      expect(reader.get()).toBe('req-1');
      expect(reader.peek()).toBe('req-1');
    });
  });

  it('до ответной фазы без писателя get() зовёт provide и hasVar', () => {
    inScope({}, () => {
      expect(() => reader.get()).toThrow(/<Var>\.provide/);
      expect(() => reader.get()).toThrow(/hasVar/);
    });
  });

  it('в ответной фазе get() говорит про Partial и предлагает peek()', () => {
    for (const phase of ['response', 'finally', 'stream'] as const) {
      inScope(
        {},
        () => {
          expect(() => reader.get()).toThrow(/response track/);
          expect(() => reader.get()).toThrow(/peek\(\)/);
        },
        phase,
      );
    }
  });

  it('присутствие — по ключу, а не по значению', () => {
    inScope({ requestId: undefined }, () => {
      expect(reader.peek()).toBeUndefined();
      // Ключ есть, значит переменная положена: get() не бросает
      expect(reader.get()).toBeUndefined();
    });
  });

  it('Signal читается по наличию scope, а не по полю input', () => {
    const signal = makeCtxReader(Signal.key) as CtxReader<AbortSignal>;

    expect(signal.peek()).toBeUndefined();
    inScope({}, () => {
      expect(signal.get()).toBe(NEVER_ABORTED);
    });
  });
});

describe('Ctx — типизированный аксессор', () => {
  it('строку не принимает', () => {
    // @ts-expect-error: Ctx принимает значение-переменную, а не ключ
    expect(() => Ctx('requestId')).toThrow(TypeError);
  });

  it('тип ридера выводится из переменной', () => {
    const token = Ctx(RequestId);
    type _Value = Expect<
      Equal<NonNullable<(typeof token)['__type']>, CtxReader<string>>
    >;

    const signalToken = Ctx(Signal);
    type _Signal = Expect<
      Equal<NonNullable<(typeof signalToken)['__type']>, CtxReader<AbortSignal>>
    >;

    expect(token.id).toBe('Ctx:requestId');
    expect(signalToken.id).toBe('Ctx:signal');
  });

  it('writer типизирован значением переменной', () => {
    // @ts-expect-error: переменная объявлена как string
    RequestId.provide(() => 1);

    const unit = RequestId.provide(() => 'req-1');
    type _Addition = Expect<
      Equal<typeof unit, PreUnitFn<EmptyInput, { requestId: string }>>
    >;

    expect(declaredVarOf(unit)).toBe(RequestId);
  });
});
