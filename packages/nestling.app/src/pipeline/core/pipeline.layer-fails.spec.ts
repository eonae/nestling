/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради рантайма */
/* eslint-disable @typescript-eslint/no-empty-function --
 * заглушка `onUnknownFail` глушит диагностику в выводе тестов */
/* eslint-disable unicorn/consistent-function-scoping --
 * юниты и фабрики вызова замыкают фикстуры своего теста */
/* eslint-disable unicorn/no-useless-undefined --
 * `undefined` из юнита — часть формы API: он значит «добавки нет» */
/**
 * Отказы, объявленные слоем: второй аргумент `.pre`, множество отказов на
 * значении пайплайна и канал `return` у pre-юнита.
 *
 * Эффективное множество декларации проверяет
 * `metadata/endpoint-errors.spec.ts`; здесь — сам пайплайн.
 */

import type {
  EndpointMeta,
  ErrorResponseContext,
  ExtendableContext,
} from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { AnyPipeline, Pipeline, PipelineTypes } from './pipeline.js';
import { compose, declaredFailsOf, makePipeline } from './pipeline.js';

import { describe, expect, it } from '@jest/globals';
import type {
  AnyFailDefinition,
  AnyInput,
  EmptyInput,
} from '@nestling/operations';
import { BadRequest, Fail, makeFail, Ok } from '@nestling/operations';

const Unauthorized = makeFail('unauthorized', { message: 'No token' });

/** Второе определение того же кода: проверка совпадения по `code` */
const UnauthorizedAgain = makeFail('unauthorized', { message: 'Still no' });

const Forbidden = makeFail('forbidden', { message: 'Nope' });

function makeCtx(
  errors: readonly AnyFailDefinition[] = [],
): ExtendableContext<EmptyInput> {
  const raw: Raw = {
    transport: 'test',
    pattern: 'TEST /',
    payload: undefined,
    attributes: {},
  };

  const endpoint: EndpointMeta = {
    transport: 'test',
    pattern: 'TEST /',
    errors,
  };

  return makeEmptyContext(raw, endpoint);
}

/** Выполняет пайплайн с ослабленными типами, как это делают транспорты */
async function run(
  pipeline: AnyPipeline,
  handler: (payload: unknown, meta: Record<string, unknown>) => unknown,
  errors: readonly AnyFailDefinition[] = [],
) {
  const executable = pipeline as unknown as Pipeline<
    EmptyInput,
    AnyInput,
    never
  >;

  return executable.executeWithHandler(
    handler,
    makeCtx(errors) as ExtendableContext<AnyInput>,
    { onUnknownFail: () => {} },
  );
}

describe('.pre(unit, { errors }) — проверка списка', () => {
  it('объявленные отказы попадают на значение пайплайна', () => {
    const authed = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });

    expect(declaredFailsOf(authed)).toEqual([Unauthorized]);
  });

  it('без второго аргумента множество остаётся пустым', () => {
    const base = makePipeline().pre(() => ({ requestId: 'r-1' }));

    expect(declaredFailsOf(base)).toEqual([]);
  });

  it('не-определение в списке → ошибка с позицией элемента и именем юнита', () => {
    function Authenticate() {
      return undefined;
    }

    const create = () =>
      makePipeline().pre(Authenticate, {
        errors: [Unauthorized, Fail as never],
      });

    expect(create).toThrow(/errors\[1] is not a fail definition/);
    expect(create).toThrow(/Authenticate/);
  });

  it('дубль кода → ошибка, называющая код', () => {
    function Authenticate() {
      return undefined;
    }

    const create = () =>
      makePipeline().pre(Authenticate, {
        errors: [Unauthorized, UnauthorizedAgain],
      });

    expect(create).toThrow(/duplicate error code 'unauthorized'/);
  });

  it('errors не массив → ошибка', () => {
    const create = () =>
      makePipeline().pre(() => undefined, {
        errors: Unauthorized as never,
      });

    expect(create).toThrow(/'errors' must be an array/);
  });
});

describe('множество отказов на значении пайплайна', () => {
  it('compose объединяет множества слоёв', () => {
    const authed = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });
    const scoped = makePipeline().pre(() => Forbidden(), {
      errors: [Forbidden],
    });

    expect(declaredFailsOf(compose(authed, scoped))).toEqual([
      Unauthorized,
      Forbidden,
    ]);
  });

  it('деривация сохраняет множество, оригинал не меняется', () => {
    const authed = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });
    const extended = authed.pre(() => ({ tenantId: 't-1' }));

    expect(declaredFailsOf(extended)).toEqual([Unauthorized]);
    expect(declaredFailsOf(authed)).toEqual([Unauthorized]);
  });

  it('ответные юниты сохраняют множество', () => {
    const authed = makePipeline()
      .pre(() => Unauthorized(), { errors: [Unauthorized] })
      .catch(() => undefined)
      .finally(() => undefined);

    expect(declaredFailsOf(authed)).toEqual([Unauthorized]);
  });

  it('bind сохраняет множество', () => {
    class Authenticate {
      handle() {
        return Unauthorized();
      }
    }

    const authed = makePipeline().pre(Authenticate, {
      errors: [Unauthorized],
    });

    expect(declaredFailsOf(authed.bind(() => new Authenticate()))).toEqual([
      Unauthorized,
    ]);
  });

  it('два определения с одним кодом схлопываются в одно', () => {
    const first = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });
    const second = makePipeline().pre(() => UnauthorizedAgain(), {
      errors: [UnauthorizedAgain],
    });

    expect(declaredFailsOf(compose(first, second))).toEqual([Unauthorized]);
  });

  it('значение не пайплайна даёт пустой список', () => {
    expect(declaredFailsOf({ pre: () => undefined })).toEqual([]);
  });
});

describe('канал return у pre-юнита', () => {
  it('объявленный отказ останавливает пайплайн и не пишет поле в input', async () => {
    const seen: string[] = [];

    const pipeline = compose(
      makePipeline().pre(() => (seen.push('auth'), Unauthorized()), {
        errors: [Unauthorized],
      }),
      makePipeline().pre(() => (seen.push('tenant'), { tenantId: 't-1' })),
    );

    const response = await run(
      pipeline,
      (_payload, meta) => (seen.push('handler'), new Ok(meta)),
      [Unauthorized],
    );

    expect(seen).toEqual(['auth']);
    expect(response.isSuccess).toBe(false);
    expect(response.value).toMatchObject({ code: 'unauthorized' });
  });

  it('ответная фаза видит тот же отказ, что при броске', async () => {
    const seen: string[] = [];
    const observe = (res: ErrorResponseContext): undefined => {
      seen.push(res.value.code);
      return undefined;
    };

    const returned = await run(
      makePipeline()
        .pre(() => Unauthorized(), { errors: [Unauthorized] })
        .catch(observe),
      () => new Ok({ ok: true }),
      [Unauthorized],
    );

    const thrown = await run(
      makePipeline()
        .pre(() => {
          throw Unauthorized();
        })
        .catch(observe),
      () => new Ok({ ok: true }),
      [Unauthorized],
    );

    expect(returned).toEqual(thrown);
    expect(seen).toEqual(['unauthorized', 'unauthorized']);
  });

  it('незадекларированный возвращённый отказ граница меняет на internal_error', async () => {
    const response = await run(
      makePipeline().pre(() => Forbidden() as never),
      () => new Ok({ ok: true }),
    );

    expect(response.value).toMatchObject({ code: 'internal_error' });
  });

  it('отказ ядра проходит границу без объявления', async () => {
    const response = await run(
      makePipeline().pre(() => BadRequest([{ message: 'bad' }])),
      () => new Ok({ ok: true }),
    );

    expect(response.value).toMatchObject({ code: 'bad_request' });
  });

  it('добавка, отказом не являющаяся, попадает в input как прежде', async () => {
    const response = await run(
      makePipeline().pre(() => ({ tenantId: 't-1' })),
      (_payload, meta) => new Ok(meta.tenantId),
    );

    expect(response.value).toBe('t-1');
  });
});

// ============================================================================
// Типовые проверки: TFails выводится и накапливается
// ============================================================================

type InferFails<P> = P extends {
  $types?: PipelineTypes<any, any, any, infer F>;
}
  ? F
  : never;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

{
  const authed = makePipeline().pre(() => Unauthorized(), {
    errors: [Unauthorized],
  });

  type Fails = InferFails<typeof authed>;
  type _AssertDeclared = Expect<Equal<Fails, ReturnType<typeof Unauthorized>>>;

  const scoped = makePipeline().pre(() => Forbidden(), {
    errors: [Forbidden],
  });

  type Composed = InferFails<typeof composed>;
  const composed = compose(authed, scoped);
  type _AssertUnion = Expect<
    Equal<
      Composed,
      ReturnType<typeof Unauthorized> | ReturnType<typeof Forbidden>
    >
  >;

  // Отказ вне списка `errors` этого `.pre` — ошибка компиляции
  // @ts-expect-error: Forbidden не объявлен на слое
  makePipeline().pre(() => Forbidden(), { errors: [Unauthorized] });

  // Отказ ядра объявления не требует
  const kernel = makePipeline().pre(() => BadRequest([{ message: 'bad' }]));

  // Добавка не смешивается с отказом: в накопленный input попадает поле
  const mixed = makePipeline().pre(
    (): { caller: string } | ReturnType<typeof Unauthorized> => Unauthorized(),
    { errors: [Unauthorized] },
  );
  type MixedAcc = typeof mixed extends {
    $types?: PipelineTypes<any, infer A, any, any>;
  }
    ? A
    : never;
  type _AssertAddition = Expect<
    MixedAcc extends { caller: string } ? true : false
  >;
}
