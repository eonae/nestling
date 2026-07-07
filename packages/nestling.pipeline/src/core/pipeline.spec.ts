/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function */
/**
 * Типовые тесты для Pipeline v2 (фазы, слои, compose, TNeeds)
 *
 * Проверяют, что:
 * 1. Input-поля корректно накапливаются pre-трактом (монотонно)
 * 2. Неправильные комбинации вызывают ошибки компиляции
 * 3. Type-state билдера: pre недоступен после ответных методов
 * 4. Честная типизация ctx по фазам (полный / Partial)
 * 5. compose проверяет требования слоёв в точке композиции
 * 6. TNeeds: класс-юнит блокирует исполнение до bind()
 */

import { validate, withIdentity, withPermissions } from '../middlewares';
import type { Logger } from '../middlewares/logging';
import { withRequestLogging } from '../middlewares/logging';
import { withRequestId } from '../middlewares/meta';

import { withTiming } from './__test-helpers__/middleware';
import type { AnyInput, EmptyInput } from './io/io';
import type { ExtendableContext } from './types/context';
import type { PreUnitFn } from './types/unit';
import type { AnyPipeline, Pipeline, PipelineTypes } from './pipeline';
import { compose, makePipeline } from './pipeline';

// ============================================================================
// Mock типы для тестов
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
}

const mockAuthenticator = async (): Promise<User> => ({
  id: '1',
  name: 'John Doe',
  email: 'john.doe@example.com',
});

const mockLogger: Logger = {
  log: () => {
    /* noop */
  },
};

// ============================================================================
// Утилиты для типовых проверок
// ============================================================================

// Извлекает накопленный input (TAcc) из pipeline
type InferAcc<P> = P extends { $types?: PipelineTypes<any, infer A, any> }
  ? A
  : never;

// Извлекает TNeeds из pipeline
type InferNeeds<P> = P extends { $types?: PipelineTypes<any, any, infer N> }
  ? N
  : never;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// Helper для создания типизированных inline pre-юнитов
function addField<T extends Record<string, unknown>>(
  value: T | (() => T | Promise<T>),
): PreUnitFn<AnyInput, T> {
  return async () => {
    if (typeof value === 'function') {
      return await value();
    }
    return value;
  };
}

// Принимает только исполнимый pipeline (как транспорты)
function acceptsExecutable(_p: Pipeline<any, any, never>): void {
  /* проверка на уровне типов */
}

// ============================================================================
// Накопление input pre-трактом
// ============================================================================

describe('Pipeline v2 — type accumulation', () => {
  it('accumulates fields through pre chain', () => {
    const pipeline = makePipeline()
      .pre(withTiming)
      .pre(withRequestLogging(mockLogger))
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(validate());

    type Acc = InferAcc<typeof pipeline>;
    type _AssertIdentity = Expect<
      Acc extends { identity: User } ? true : false
    >;
    type _AssertTimestamp = Expect<
      Acc extends { timestamp: number } ? true : false
    >;
    type _AssertPayload = Expect<
      Acc extends { payload: unknown } ? true : false
    >;
  });

  it('units may depend on previously added fields', () => {
    const pipeline = makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withPermissions<string[], User>(() => ['read']));

    type Acc = InferAcc<typeof pipeline>;
    type _AssertPermissions = Expect<
      Acc extends { permissions: string[] } ? true : false
    >;
  });

  it('rejects a unit whose requirements are not met yet', () => {
    const pipeline = makePipeline();

    // identity ещё не добавлена — withPermissions требует её
    // @ts-expect-error: Input is not assignable to pre-unit input
    pipeline.pre(withPermissions<string[], User>(() => ['read']));
  });

  it('rejects overriding a field with a different type', () => {
    const pipeline = makePipeline().pre(addField({ userId: 'abc' }));

    // @ts-expect-error: Pre-unit is overriding fields in input
    pipeline.pre(addField({ userId: 42 }));
  });

  it('allows re-adding a field with the same type', () => {
    const pipeline = makePipeline().pre(withTiming).pre(withTiming);

    type Acc = InferAcc<typeof pipeline>;
    type _AssertTimestamp = Expect<
      Acc extends { timestamp: number } ? true : false
    >;
  });

  it('base pipeline is immutable and reusable', () => {
    const base = makePipeline().pre(withTiming);

    const withAuth = base.pre(withIdentity<User>(mockAuthenticator));
    const withReq = base.pre(withRequestId());

    type AuthAcc = InferAcc<typeof withAuth>;
    type ReqAcc = InferAcc<typeof withReq>;

    type _AuthHasIdentity = Expect<
      AuthAcc extends { identity: User } ? true : false
    >;
    // Ветки не протекают друг в друга
    type _ReqHasNoIdentity = Expect<
      ReqAcc extends { identity: User } ? false : true
    >;
    type _AuthHasNoRequestId = Expect<
      AuthAcc extends { requestId: string } ? false : true
    >;
  });
});

// ============================================================================
// Type-state билдера
// ============================================================================

describe('Pipeline v2 — builder type-state', () => {
  it('pre is not available after a response-phase method', () => {
    const phased = makePipeline()
      .pre(withTiming)
      .catch(() => {});

    expect(() => {
      // @ts-expect-error: pre отсутствует после ответного метода
      phased.pre(withRequestId());
    }).toThrow(/pre\(\) is not available/);
  });

  it('response methods stay available after each other', () => {
    const pipeline = makePipeline()
      .pre(withTiming)
      .ok(() => {})
      .catch(() => {})
      .after(() => {})
      .finally(() => {});

    acceptsExecutable(pipeline);
  });
});

// ============================================================================
// Честная типизация ctx по фазам
// ============================================================================

describe('Pipeline v2 — phase ctx typing', () => {
  it('ok sees the full accumulated ctx', () => {
    makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withRequestId())
      .ok((res, ctx) => {
        type _Identity = Expect<Equal<typeof ctx.input.identity, User>>;
        type _RequestId = Expect<Equal<typeof ctx.input.requestId, string>>;
        type _Success = Expect<Equal<typeof res.isSuccess, true>>;
        return;
      });
  });

  it('catch and after see own-layer fields as Partial', () => {
    makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .catch((error, ctx) => {
        type _Identity = Expect<
          Equal<typeof ctx.input.identity, User | undefined>
        >;
        type _Failure = Expect<Equal<typeof error.isSuccess, false>>;
        return;
      })
      .after((res, ctx) => {
        type _Identity = Expect<
          Equal<typeof ctx.input.identity, User | undefined>
        >;
        return;
      });
  });

  it('layer requirements (TReq) are guaranteed on the response track', () => {
    makePipeline<{ requestId: string }>()
      .pre(withIdentity<User>(mockAuthenticator))
      .catch((error, ctx) => {
        // Внешнее требование — гарантировано
        type _RequestId = Expect<Equal<typeof ctx.input.requestId, string>>;
        // Собственное поле слоя — Partial
        type _Identity = Expect<
          Equal<typeof ctx.input.identity, User | undefined>
        >;
        return;
      });
  });

  it('ok cannot return an error response, catch cannot return success', () => {
    makePipeline()
      .pre(withTiming)
      // @ts-expect-error: ok-юнит не может вернуть ошибку
      .ok(() => ({
        isSuccess: false as const,
        status: 'INTERNAL_ERROR' as const,
        value: { error: 'boom' },
      }));

    makePipeline()
      .pre(withTiming)
      // @ts-expect-error: catch-юнит не может вернуть успех
      .catch(() => ({
        isSuccess: true as const,
        status: 'OK' as const,
        value: {},
      }));
  });
});

// ============================================================================
// Композиция слоёв
// ============================================================================

describe('Pipeline v2 — compose', () => {
  it('composes layers and merges accumulated input', () => {
    const base = makePipeline().pre(withRequestId());
    const authed = makePipeline<{ requestId: string }>().pre(
      withIdentity<User>(mockAuthenticator),
    );

    const composed = compose(base, authed);

    type Acc = InferAcc<typeof composed>;
    type _HasRequestId = Expect<
      Acc extends { requestId: string } ? true : false
    >;
    type _HasIdentity = Expect<Acc extends { identity: User } ? true : false>;

    acceptsExecutable(composed);
  });

  it('rejects composition when inner requirements are not satisfied', () => {
    const base = makePipeline().pre(withTiming);
    const needsIdentity = makePipeline<{ identity: User }>().pre(
      withRequestId(),
    );

    // @ts-expect-error: внешние слои не предоставляют identity
    compose(base, needsIdentity);
  });

  it('three-layer composition checks requirements transitively', () => {
    const base = makePipeline().pre(withRequestId());
    const authed = makePipeline<{ requestId: string }>().pre(
      withIdentity<User>(mockAuthenticator),
    );
    const authorized = makePipeline<{ identity: User }>().pre(
      withPermissions<string[], User>(() => ['read']),
    );

    const composed = compose(base, authed, authorized);

    type Acc = InferAcc<typeof composed>;
    type _HasPermissions = Expect<
      Acc extends { permissions: string[] } ? true : false
    >;
  });
});

// ============================================================================
// TNeeds: классы-юниты
// ============================================================================

class WithTracing {
  handle(ctx: ExtendableContext<EmptyInput>): { traceId: string } {
    return { traceId: 'trace-1' };
  }
}

describe('Pipeline v2 — TNeeds', () => {
  it('function and instance units keep the pipeline executable', () => {
    const pipeline = makePipeline().pre(withTiming).pre(new WithTracing());

    type Needs = InferNeeds<typeof pipeline>;
    type _NoNeeds = Expect<Equal<Needs, never>>;

    acceptsExecutable(pipeline);
  });

  it('class unit adds its constructor to TNeeds and blocks execution', () => {
    const pipeline = makePipeline().pre(WithTracing);

    type Needs = InferNeeds<typeof pipeline>;
    type _HasNeeds = Expect<Equal<Needs, typeof WithTracing>>;

    type Acc = InferAcc<typeof pipeline>;
    type _HasTraceId = Expect<Acc extends { traceId: string } ? true : false>;

    // @ts-expect-error: pipeline с нерезолвленными классами не исполним
    acceptsExecutable(pipeline);
  });

  it('bind() resolves TNeeds to never', () => {
    const pipeline = makePipeline().pre(WithTracing);
    const bound = pipeline.bind(() => new WithTracing());

    type Needs = InferNeeds<typeof bound>;
    type _NoNeeds = Expect<Equal<Needs, never>>;

    acceptsExecutable(bound);
  });
});

// ============================================================================
// Мета хендлера: накопленный input без payload + signal
// ============================================================================

describe('Pipeline v2 — handler meta typing', () => {
  it('meta includes accumulated fields and guaranteed signal', async () => {
    const pipeline = makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(validate());

    type Acc = InferAcc<typeof pipeline>;

    // Смоук: сигнатура executeWithHandler выводит meta из Acc
    const use = (): Promise<unknown> =>
      pipeline.executeWithHandler(
        (payload, meta) => {
          type _Signal = Expect<Equal<typeof meta.signal, AbortSignal>>;
          type _Identity = Expect<Equal<typeof meta.identity, User>>;
          type _NoPayloadInMeta = Expect<
            'payload' extends keyof typeof meta ? false : true
          >;
          return { ok: true };
        },
        // Контекст в тестах создаётся транспортом; здесь только типовая проверка
        undefined as unknown as ExtendableContext<Acc>,
      );

    expect(typeof use).toBe('function');
  });
});
