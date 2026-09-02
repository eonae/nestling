/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function */
/**
 * Типовые тесты для Pipeline v2: фазы, слои, compose, TNeeds.
 *
 * Проверяют, что:
 * 1. input-поля корректно накапливаются pre-юнитами (монотонно).
 * 2. Неправильные комбинации вызывают ошибки компиляции.
 * 3. Type-state билдера: pre недоступен после ответных методов.
 * 4. Ctx по фазам типизирован честно: полный или Partial.
 * 5. compose проверяет требования слоёв в точке композиции.
 * 6. TNeeds: класс-юнит блокирует исполнение до bind().
 */

// Публичная поверхность пакета: `AfterUnitFn` удалён вместе с фазой `.after`
// (change pipeline-drop-after). Если тип вернётся в экспорт — директива
// станет неиспользованной и tsc сообщит об этом.
// @ts-expect-error: AfterUnitFn больше не экспортируется из @nestling/pipeline
import type { AfterUnitFn } from '../index';
import { withIdentity, withPermissions } from '../middlewares';
import type { Logger } from '../middlewares/logging';
import { withRequestLogging } from '../middlewares/logging';
import { withRequestId } from '../middlewares/meta';

import { withTiming } from './__test-helpers__/middleware';
import type { ExtendableContext } from './types/context';
import type { PreUnitFn } from './types/unit';
import type { AnyPipeline, Pipeline, PipelineTypes } from './pipeline';
import { compose, makePipeline } from './pipeline';

import type { AnyInput, EmptyInput } from '@nestling/operations';

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

// Извлекает требования слоя (TReq) из pipeline
type InferReq<P> = P extends { $types?: PipelineTypes<infer R, any, any> }
  ? R
  : never;

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

// Создаёт типизированный inline pre-юнит
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

// Юнит, подменяющий кандидата проверки входа: рантайм проверит по схеме
// `input` именно его значение, а в мету хендлера ключ не попадёт
const withPayload: PreUnitFn<AnyInput, { payload: unknown }> = async (ctx) => ({
  payload: ctx.raw.payload,
});

// ============================================================================
// Накопление input `.pre`-юнитами
// ============================================================================

describe('Pipeline v2 — накопление input pre-юнитами', () => {
  it('накапливает поля через цепочку pre-юнитов', () => {
    const pipeline = makePipeline()
      .pre(withTiming)
      .pre(withRequestLogging(mockLogger))
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withPayload);

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

  it('юнит может использовать поле, добавленное предыдущим юнитом', () => {
    const pipeline = makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withPermissions<string[], User>(() => ['read']));

    type Acc = InferAcc<typeof pipeline>;
    type _AssertPermissions = Expect<
      Acc extends { permissions: string[] } ? true : false
    >;
  });

  it('отклоняет юнит, чьи требования ещё не выполнены', () => {
    const pipeline = makePipeline();

    // identity ещё не добавлена — withPermissions требует её
    // @ts-expect-error: Input is not assignable to pre-unit input
    pipeline.pre(withPermissions<string[], User>(() => ['read']));
  });

  it('отклоняет переопределение поля другим типом', () => {
    const pipeline = makePipeline().pre(addField({ userId: 'abc' }));

    // @ts-expect-error: pre-юнит переопределяет поле input другим типом
    pipeline.pre(addField({ userId: 42 }));
  });

  it('разрешает повторно добавить поле того же типа', () => {
    const pipeline = makePipeline().pre(withTiming).pre(withTiming);

    type Acc = InferAcc<typeof pipeline>;
    type _AssertTimestamp = Expect<
      Acc extends { timestamp: number } ? true : false
    >;
  });

  it('базовый пайплайн иммутабелен и переиспользуется', () => {
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

describe('Pipeline v2 — типовое состояние билдера', () => {
  it('pre недоступен после ответного метода', () => {
    const phased = makePipeline()
      .pre(withTiming)
      .catch(() => {});

    expect(() => {
      // @ts-expect-error: pre отсутствует после ответного метода
      phased.pre(withRequestId());
      // Сообщение ошибки перечисляет актуальный список ответных методов
    }).toThrow(
      'pre() is not available after a response-phase method (.ok/.catch/.finally)',
    );
  });

  it('ответные методы остаются доступны друг после друга', () => {
    const pipeline = makePipeline()
      .pre(withTiming)
      .ok(() => {})
      .catch(() => {})
      .finally(() => {});

    acceptsExecutable(pipeline);
  });

  it('after больше не входит в билдер', () => {
    expect(() => {
      // @ts-expect-error: метод .after удалён из списка ответных методов
      makePipeline().after(() => {});
    }).toThrow(TypeError);
  });
});

// ============================================================================
// Честная типизация ctx по фазам
// ============================================================================

describe('Pipeline v2 — типизация ctx по фазам', () => {
  it('ok видит весь накопленный ctx', () => {
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

  it('catch и finally видят поля своего слоя как Partial', () => {
    makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .catch((error, ctx) => {
        type _Identity = Expect<
          Equal<typeof ctx.input.identity, User | undefined>
        >;
        type _Failure = Expect<Equal<typeof error.isSuccess, false>>;
        return;
      })
      .finally((outcome, res, ctx) => {
        type _Identity = Expect<
          Equal<typeof ctx.input.identity, User | undefined>
        >;
        return;
      });
  });

  it('требования слоя (TReq) гарантированы в ответной фазе', () => {
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

  it('ok не может вернуть ответ с ошибкой, catch не может вернуть успех', () => {
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
  it('compose объединяет слои и их накопленный input', () => {
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

  it('отклоняет композицию, если требования внутреннего слоя не выполнены', () => {
    const base = makePipeline().pre(withTiming);
    const needsIdentity = makePipeline<{ identity: User }>().pre(
      withRequestId(),
    );

    // @ts-expect-error: внешние слои не предоставляют identity
    compose(base, needsIdentity);
  });

  it('композиция трёх слоёв проверяет требования транзитивно', () => {
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

  // Позитивный вывод типов на всех арностях. Тесты написаны до
  // переписывания сигнатуры `compose` на прямой вывод (change #23) и
  // обязаны остаться зелёными после: они и есть страховка, что правка
  // горячей сигнатуры не поменяла наблюдаемые типы.
  it('накапливает input на арностях 2, 3 и 4', () => {
    const base = makePipeline().pre(withRequestId());
    const authed = makePipeline<{ requestId: string }>().pre(
      withIdentity<User>(mockAuthenticator),
    );
    const authorized = makePipeline<{ identity: User }>().pre(
      withPermissions<string[], User>(() => ['read']),
    );
    const timed = makePipeline<{ permissions: string[] }>().pre(withTiming);

    const two = compose(base, authed);
    const three = compose(base, authed, authorized);
    const four = compose(base, authed, authorized, timed);

    type Two = InferAcc<typeof two>;
    type _TwoKeys = Expect<Equal<keyof Two, 'requestId' | 'identity'>>;
    type _TwoRequestId = Expect<Equal<Two['requestId'], string>>;
    type _TwoIdentity = Expect<Equal<Two['identity'], User>>;

    type Three = InferAcc<typeof three>;
    type _ThreeKeys = Expect<
      Equal<keyof Three, 'requestId' | 'identity' | 'permissions'>
    >;
    type _ThreePermissions = Expect<Equal<Three['permissions'], string[]>>;

    type Four = InferAcc<typeof four>;
    type _FourKeys = Expect<
      Equal<keyof Four, 'requestId' | 'identity' | 'permissions' | 'timestamp'>
    >;
    type _FourTimestamp = Expect<Equal<Four['timestamp'], number>>;

    acceptsExecutable(two);
    acceptsExecutable(three);
    acceptsExecutable(four);
  });

  it('объединяет отложенные зависимости всех слоёв', () => {
    const base = makePipeline().pre(withRequestId());
    const traced = makePipeline<{ requestId: string }>().pre(WithTracing);

    const composed = compose(base, traced);

    type Needs = InferNeeds<typeof composed>;
    type _Needs = Expect<Equal<Needs, typeof WithTracing>>;

    // @ts-expect-error: композиция с нерезолвленным классом-юнитом не исполнима
    acceptsExecutable(composed);

    type BoundNeeds = InferNeeds<ReturnType<(typeof composed)['bind']>>;
    type _Bound = Expect<Equal<BoundNeeds, never>>;
  });

  it('мета хендлера составленного пайплайна содержит накопленный input', () => {
    const base = makePipeline().pre(withRequestId());
    const authed = makePipeline<{ requestId: string }>()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withPayload);

    const composed = compose(base, authed);

    type Acc = InferAcc<typeof composed>;

    const use = (): Promise<unknown> =>
      composed.executeWithHandler(
        (payload, meta) => {
          type _RequestId = Expect<Equal<typeof meta.requestId, string>>;
          type _Identity = Expect<Equal<typeof meta.identity, User>>;
          type _Signal = Expect<Equal<typeof meta.signal, AbortSignal>>;
          type _NoPayloadInMeta = Expect<
            'payload' extends keyof typeof meta ? false : true
          >;
          return { ok: true };
        },
        undefined as unknown as ExtendableContext<Acc>,
      );

    expect(typeof use).toBe('function');
  });

  it('сохраняет TReq внешнего слоя в результате', () => {
    const rawLayer = makePipeline<{ rawBody: Uint8Array }>().pre(withTiming);
    const inner = makePipeline<{ rawBody: Uint8Array; timestamp: number }>();

    const composed = compose(rawLayer, inner);

    type Req = InferReq<typeof composed>;
    type _Req = Expect<Equal<Req, { rawBody: Uint8Array }>>;

    // `TReq` кодируется фантомным `$types` и ведёт себя **ковариантно**:
    // пайплайн с требованиями присваивается слоту без них. Именно поэтому
    // транспорту недостаточно типизировать слот
    // `pipeline?: Pipeline<Start, …>`, и потребовалась отдельная проверка
    // `ValidateStart` (@nestling/transport.http).
    const slot: Pipeline<EmptyInput, AnyInput, never> = composed;

    expect(slot).toBeDefined();
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
  it('функция и экземпляр класса в pre оставляют пайплайн исполнимым', () => {
    const pipeline = makePipeline().pre(withTiming).pre(new WithTracing());

    type Needs = InferNeeds<typeof pipeline>;
    type _NoNeeds = Expect<Equal<Needs, never>>;

    acceptsExecutable(pipeline);
  });

  it('класс-юнит добавляет свой конструктор в TNeeds и блокирует исполнение', () => {
    const pipeline = makePipeline().pre(WithTracing);

    type Needs = InferNeeds<typeof pipeline>;
    type _HasNeeds = Expect<Equal<Needs, typeof WithTracing>>;

    type Acc = InferAcc<typeof pipeline>;
    type _HasTraceId = Expect<Acc extends { traceId: string } ? true : false>;

    // @ts-expect-error: pipeline с нерезолвленными классами не исполним
    acceptsExecutable(pipeline);
  });

  it('bind() разрешает TNeeds в never', () => {
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

describe('Pipeline v2 — типизация меты хендлера', () => {
  it('мета включает накопленные поля и гарантированный signal', async () => {
    const pipeline = makePipeline()
      .pre(withIdentity<User>(mockAuthenticator))
      .pre(withPayload);

    type Acc = InferAcc<typeof pipeline>;

    // Проверка типов: сигнатура executeWithHandler выводит meta из Acc
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
        // Контекст в тестах создаёт транспорт. Здесь только проверка типов
        undefined as unknown as ExtendableContext<Acc>,
      );

    expect(typeof use).toBe('function');
  });
});
