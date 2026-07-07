import type { AnyInput, EmptyInput } from './io/io.js';
import type {
  ErrorDetails,
  ExtendableContext,
  ResponseContext,
} from './types/context.js';
import type {
  AfterUnitFn,
  AnyAddition,
  CatchUnitFn,
  FinallyUnitFn,
  OkUnitFn,
  PreUnitFn,
  ResponseTrackInput,
  UnitInstance,
  UnitLike,
} from './types/unit.js';
import { computeOutcome } from './abort.js';
import type { Output, OutputSync } from './result.js';
import { Fail, Ok } from './result.js';

import type { Constructor } from '@common/misc';

/**
 * Опции выполнения pipeline.
 *
 * exposeErrorDetails — раскрывать ли клиенту детали НЕобработанных ошибок
 * (не `Fail`): `error.message` и `stack`. По умолчанию `false` — в тело
 * уходит только generic-сообщение. Политика раскрытия — свойство окружения
 * (транспорт/приложение), поэтому передаётся при вызове, а не хранится в
 * самом (переиспользуемом) Pipeline.
 */
export interface ExecuteOptions {
  exposeErrorDetails?: boolean;
}

type OverlapKeys<A, B> = keyof A & keyof B;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Общие ключи, у которых типы в A и B не идентичны.
 *
 * Повторное добавление поля с тем же типом (например, два withTiming
 * в одной цепочке) конфликтом не считается: input от этого не меняется.
 */
type ConflictingKeys<A, B> = {
  [K in OverlapKeys<A, B>]: [A[K], B[K]] extends [B[K], A[K]] ? never : K;
}[OverlapKeys<A, B>];

/**
 * Проверяет совместимость TReq и TAdd юнита с текущим накопленным input.
 * TAdd нормализуется до проверки: юнит, ничего не добавляющий
 * (undefined/never), не конфликтует ни с чем.
 */
type CheckPreCompatibility<TCurrentInput, TReq, TAdd, M> = [
  TCurrentInput,
] extends [TReq]
  ? [ConflictingKeys<TCurrentInput, NormalizeAddition<TAdd>>] extends [never]
    ? M
    : {
        ERROR: 'Pre-unit is overriding fields in input';
        CONFLICTING_KEYS: ConflictingKeys<
          TCurrentInput,
          NormalizeAddition<TAdd>
        >;
        CURRENT_INPUT: Simplify<TCurrentInput>;
        UNIT_ADDITION: TAdd;
      }
  : {
      ERROR: 'Input is not assignable to pre-unit input';
      CURRENT_INPUT: Simplify<TCurrentInput>;
      UNIT_EXPECTS: TReq;
    };

/**
 * Валидирует совместимость pre-юнита (в любой из трёх форм)
 * с текущим накопленным input
 */
type ValidatePreUnit<TCurrentInput extends AnyInput, M> =
  M extends Constructor<UnitInstance<PreUnitFn<infer TReq, infer TAdd>>>
    ? CheckPreCompatibility<TCurrentInput, TReq, TAdd, M>
    : M extends PreUnitFn<infer TReq, infer TAdd>
      ? CheckPreCompatibility<TCurrentInput, TReq, TAdd, M>
      : M extends UnitInstance<PreUnitFn<infer TReq, infer TAdd>>
        ? CheckPreCompatibility<TCurrentInput, TReq, TAdd, M>
        : never;

/**
 * Юнит, ничего не добавляющий в input (TAddition = undefined),
 * не должен менять тип pipeline: undefined/never приводятся к {}.
 * Объявлен до CheckPreCompatibility, которая им пользуется.
 */
type NormalizeAddition<TAdd> = [TAdd] extends [never]
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}
  : TAdd extends AnyAddition
    ? TAdd
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

/**
 * Извлекает TAddition из pre-юнита любой формы
 */
type ExtractAddition<M> =
  M extends Constructor<UnitInstance<PreUnitFn<any, infer TAdd>>>
    ? NormalizeAddition<TAdd>
    : M extends PreUnitFn<any, infer TAdd>
      ? NormalizeAddition<TAdd>
      : M extends UnitInstance<PreUnitFn<any, infer TAdd>>
        ? NormalizeAddition<TAdd>
        : never;

/**
 * Извлекает отложенную зависимость юнита: класс-форма добавляет
 * свой конструктор в TNeeds, остальные формы — ничего
 */
type ExtractNeeds<M> = M extends Constructor<UnitInstance<any>> ? M : never;

/**
 * Фантомный носитель тип-параметров pipeline (в рантайме отсутствует).
 * Нужен для надёжного вывода типов в `compose` и хелперах.
 */
export interface PipelineTypes<
  TReq extends AnyInput,
  TAcc extends AnyInput,
  TNeeds,
> {
  req: TReq;
  acc: TAcc;
  needs: TNeeds;
}

/**
 * Резолвер отложенных зависимостей (классов-юнитов) для `bind`
 */
export type UnitResolver = (ctor: Constructor<unknown>) => unknown;

/**
 * Pipeline — иммутабельное исполнимое значение.
 *
 * @param TReq - требования слоя к внешнему контексту (задаются
 * `makePipeline<TReq>()`, проверяются в точке композиции)
 * @param TAcc - накопленный pre-трактом input (включая TReq)
 * @param TNeeds - отложенные зависимости (конструкторы классов-юнитов);
 * `never` — пайплайн исполним; иначе требуется `bind()` (App делает это
 * автоматически на старте)
 */
export interface Pipeline<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> {
  /** @internal фантомное поле для вывода типов */
  readonly $types?: PipelineTypes<TReq, TAcc, TNeeds>;

  /**
   * Материализует классы-юниты через резолвер (обычно — DI-контейнер).
   * Возвращает исполнимый pipeline (`TNeeds = never`).
   */
  bind(resolve: UnitResolver): Pipeline<TReq, TAcc, never>;

  /**
   * Выполняет pipeline с handler.
   *
   * Доступен только при `TNeeds = never` (все классы-юниты зарезолвлены).
   *
   * @param handler - бизнес-логика endpoint (получает payload и meta отдельно)
   * @param ctx - начальный контекст от транспорта
   */
  executeWithHandler<TOutput>(
    this: Pipeline<TReq, TAcc, never>,
    handler: (
      payload: TAcc extends { payload: infer P } ? P : undefined,
      meta: (TAcc extends { payload: unknown }
        ? Omit<TAcc, 'payload'>
        : TAcc) & { signal: AbortSignal },
    ) => OutputSync<TOutput> | Output<TOutput>,
    ctx: ExtendableContext<TAcc>,
    options?: ExecuteOptions,
  ): Promise<ResponseContext<TOutput>>;
}

/**
 * Слой, в котором начался ответный тракт: pre больше недоступен
 * (декларация читается сверху вниз = порядок исполнения).
 */
export interface PhasedPipeline<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> extends Pipeline<TReq, TAcc, TNeeds> {
  /** Юнит на успешный ответ: полный ctx, может заменить успех успехом */
  ok<M extends UnitLike<OkUnitFn<TAcc>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;

  /** Юнит на ответ-ошибку: свой слой Partial, может заменить ошибку ошибкой */
  catch<M extends UnitLike<CatchUnitFn<ResponseTrackInput<TReq, TAcc>>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;

  /** Юнит на любой ответ: свой слой Partial, может заменить ответ */
  after<M extends UnitLike<AfterUnitFn<ResponseTrackInput<TReq, TAcc>>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;

  /** Наблюдатель исхода: вызывается всегда, последним */
  finally<M extends UnitLike<FinallyUnitFn<ResponseTrackInput<TReq, TAcc>>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;
}

/**
 * Билдер слоя: pre-тракт ещё открыт
 */
export interface PipelineBuilder<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> extends PhasedPipeline<TReq, TAcc, TNeeds> {
  /** Юнит до хендлера: монотонно накапливает input */
  pre<M extends UnitLike<PreUnitFn<any, any>>>(
    unit: ValidatePreUnit<TAcc, M>,
  ): PipelineBuilder<TReq, TAcc & ExtractAddition<M>, TNeeds | ExtractNeeds<M>>;
}

export type AnyPipeline = Pipeline<any, any, any>;

type ReqOf<P> = P extends { $types?: PipelineTypes<infer R, any, any> }
  ? R
  : never;
type AccOf<P> = P extends { $types?: PipelineTypes<any, infer A, any> }
  ? A
  : never;
type NeedsOf<P> = P extends { $types?: PipelineTypes<any, any, infer N> }
  ? N
  : never;

/**
 * Проверка точки композиции: внешние слои должны предоставлять всё,
 * что требует внутренний (`makePipeline<TReq>()`)
 */
type ValidateCompose<Outer extends AnyPipeline, Inner extends AnyPipeline> = [
  AccOf<Outer>,
] extends [ReqOf<Inner>]
  ? Inner
  : {
      ERROR: 'Inner layer requirements are not satisfied by outer layers';
      MISSING_FIELDS: Exclude<keyof ReqOf<Inner>, keyof AccOf<Outer>>;
      OUTER_PROVIDES: Simplify<AccOf<Outer>>;
      INNER_REQUIRES: Simplify<ReqOf<Inner>>;
    };

type ComposeResult<
  Outer extends AnyPipeline,
  Inner extends AnyPipeline,
> = Pipeline<
  ReqOf<Outer>,
  AccOf<Outer> & AccOf<Inner>,
  NeedsOf<Outer> | NeedsOf<Inner>
>;

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

type AnyUnitFn = (...args: unknown[]) => unknown;

interface UnitEntry {
  /** Материализованный юнит (функция или связанный handle инстанса) */
  fn?: AnyUnitFn;
  /** Класс-форма: конструктор до резолва через bind() */
  ctor?: Constructor<UnitInstance<AnyUnitFn>>;
}

type ResponsePhase = 'ok' | 'catch' | 'after';

interface ResponseEntry extends UnitEntry {
  phase: ResponsePhase;
}

interface Layer {
  pre: UnitEntry[];
  responses: ResponseEntry[];
  finals: UnitEntry[];
}

function normalizeUnit(unit: unknown): UnitEntry {
  if (typeof unit === 'function') {
    // Класс-юнит: у прототипа есть handle. Обычная функция — юнит сама по себе.
    const proto = (unit as { prototype?: { handle?: unknown } }).prototype;
    if (proto && typeof proto.handle === 'function') {
      return { ctor: unit as Constructor<UnitInstance<AnyUnitFn>> };
    }
    return { fn: unit as AnyUnitFn };
  }

  if (
    unit !== null &&
    typeof unit === 'object' &&
    typeof (unit as UnitInstance<AnyUnitFn>).handle === 'function'
  ) {
    const instance = unit as UnitInstance<AnyUnitFn>;
    return { fn: instance.handle.bind(instance) };
  }

  throw new TypeError(
    'Pipeline unit must be a function, an instance with handle(), or a class with handle()',
  );
}

function cloneLayer(layer: Layer): Layer {
  return {
    pre: [...layer.pre],
    responses: [...layer.responses],
    finals: [...layer.finals],
  };
}

/**
 * Возвращает материализованный юнит. Недостижимо после проверки
 * unresolved-классов в executeWithHandler — защита от рассинхрона.
 */
function materialized(entry: UnitEntry): AnyUnitFn {
  if (!entry.fn) {
    throw new Error('Pipeline unit is not materialized; call bind() first');
  }
  return entry.fn;
}

/**
 * Единственная рантайм-реализация pipeline. Наружу отдаётся только
 * под типами Pipeline / PhasedPipeline / PipelineBuilder — type-state
 * билдера обеспечивается типами, рантайм-проверки дублируют его
 * для JS-потребителей.
 */
class PipelineImpl {
  constructor(
    private readonly layers: Layer[],
    /** true после первого ответного метода: pre больше недоступен */
    private readonly sealed: boolean,
    /** true для результата compose: юниты добавлять больше нельзя */
    private readonly composed = false,
  ) {}

  static emptyLayer(): PipelineImpl {
    return new PipelineImpl([{ pre: [], responses: [], finals: [] }], false);
  }

  static compose(pipelines: PipelineImpl[]): PipelineImpl {
    return new PipelineImpl(
      pipelines.flatMap((p) => p.layers.map(cloneLayer)),
      true,
      true,
    );
  }

  private withOwnLayer(
    mutate: (layer: Layer) => void,
    sealed: boolean,
  ): PipelineImpl {
    if (this.composed) {
      throw new Error(
        'Cannot add units to a composed pipeline; add them to a layer before compose()',
      );
    }
    // Builder всегда владеет ровно одним слоем
    const layer = cloneLayer(this.layers[0]);
    mutate(layer);
    return new PipelineImpl([layer], sealed);
  }

  pre(unit: unknown): PipelineImpl {
    if (this.sealed) {
      throw new Error(
        'pre() is not available after a response-phase method (.ok/.catch/.after/.finally)',
      );
    }
    return this.withOwnLayer((l) => l.pre.push(normalizeUnit(unit)), false);
  }

  ok(unit: unknown): PipelineImpl {
    return this.withOwnLayer(
      (l) => l.responses.push({ ...normalizeUnit(unit), phase: 'ok' }),
      true,
    );
  }

  catch(unit: unknown): PipelineImpl {
    return this.withOwnLayer(
      (l) => l.responses.push({ ...normalizeUnit(unit), phase: 'catch' }),
      true,
    );
  }

  after(unit: unknown): PipelineImpl {
    return this.withOwnLayer(
      (l) => l.responses.push({ ...normalizeUnit(unit), phase: 'after' }),
      true,
    );
  }

  finally(unit: unknown): PipelineImpl {
    return this.withOwnLayer((l) => l.finals.push(normalizeUnit(unit)), true);
  }

  bind(resolve: UnitResolver): PipelineImpl {
    const resolveEntry = <E extends UnitEntry>(entry: E): E => {
      if (!entry.ctor) {
        return entry;
      }
      const instance = resolve(entry.ctor as Constructor<unknown>);
      if (
        instance === null ||
        typeof instance !== 'object' ||
        typeof (instance as UnitInstance<AnyUnitFn>).handle !== 'function'
      ) {
        throw new Error(
          `Cannot bind pipeline unit ${entry.ctor.name}: resolver returned no instance with handle()`,
        );
      }
      const unit = instance as UnitInstance<AnyUnitFn>;
      return { ...entry, ctor: undefined, fn: unit.handle.bind(unit) };
    };

    return new PipelineImpl(
      this.layers.map((layer) => ({
        pre: layer.pre.map(resolveEntry),
        responses: layer.responses.map(resolveEntry),
        finals: layer.finals.map(resolveEntry),
      })),
      this.sealed,
      this.composed,
    );
  }

  async executeWithHandler(
    handler: (payload: unknown, meta: AnyAddition) => unknown,
    ctx: ExtendableContext<AnyInput>,
    options: ExecuteOptions = {},
  ): Promise<ResponseContext<unknown>> {
    const unresolved = this.layers
      .flatMap((l) => [...l.pre, ...l.responses, ...l.finals])
      .find((entry) => entry.ctor);
    if (unresolved?.ctor) {
      throw new Error(
        `Pipeline has unresolved class units (${unresolved.ctor.name}); ` +
          'call bind() or run under App',
      );
    }

    const exposeErrorDetails = options.exposeErrorDetails ?? false;

    let currentCtx: ExtendableContext<AnyInput> = ctx;
    let response: ResponseContext<unknown>;
    const activated: Layer[] = [];

    try {
      // Pre-тракты слоёв: снаружи внутрь. Слой считается активированным,
      // как только начался его pre — его ответный тракт исполнится.
      for (const layer of this.layers) {
        activated.push(layer);
        for (const entry of layer.pre) {
          const append = (await materialized(entry)(currentCtx)) as
            | AnyAddition
            | undefined;

          currentCtx = {
            ...currentCtx,
            input: {
              ...currentCtx.input,
              ...append,
            },
          };
        }
      }

      // Извлекаем payload и meta из накопленного input
      const finalInput = currentCtx.input;
      const { payload, ...meta } = finalInput as AnyAddition & {
        payload?: unknown;
      };

      // Если pre-тракт не добавил payload (нет validate()), передаём
      // handler'у сырой payload, подготовленный транспортом
      const effectivePayload =
        'payload' in finalInput ? payload : ctx.raw.payload;

      // Ключ `signal` зарезервирован: сигнал контекста перекрывает
      // одноимённое поле, добавленное pre-юнитом.
      const result = await handler(effectivePayload, {
        ...meta,
        signal: ctx.signal,
      });
      response = this.normalizeResponse(result);
    } catch (error) {
      response = this.errorToResponse(error, exposeErrorDetails);
    }

    // Ответный тракт: активированные слои изнутри наружу; юниты слоя —
    // в порядке объявления, по применимости к ТЕКУЩЕМУ ответу.
    const innerToOuter = [...activated].reverse();
    for (const layer of innerToOuter) {
      for (const entry of layer.responses) {
        const applicable =
          entry.phase === 'after' ||
          (entry.phase === 'ok') === response.isSuccess;
        if (!applicable) {
          continue;
        }

        try {
          const replaced = (await materialized(entry)(response, currentCtx)) as
            | ResponseContext<unknown>
            | undefined;
          if (replaced !== undefined && replaced !== null) {
            response = replaced;
          }
        } catch (error) {
          // Падение ответного юнита — необработанная ошибка: ответ
          // заменяется по общей политике, остальные юниты продолжают.
          response = this.errorToResponse(error, exposeErrorDetails);
        }
      }
    }

    // Finally: изнутри наружу, всегда. Ошибки наблюдателей не влияют
    // на ответ (юнит обязан обрабатывать свои ошибки сам).
    const outcome = computeOutcome(ctx.signal, response);
    for (const layer of innerToOuter) {
      for (const entry of layer.finals) {
        try {
          await materialized(entry)(outcome, response, currentCtx);
        } catch {
          // намеренно проглатывается: finally — наблюдатель
        }
      }
    }

    return response;
  }

  /**
   * Нормализует результат handler'а в ResponseContext
   */
  private normalizeResponse<T>(result: T): ResponseContext<T> {
    if (result instanceof Ok) {
      return {
        isSuccess: true,
        status: result.status,
        value: result.value as T,
        headers: result.headers,
      };
    }

    return {
      isSuccess: true,
      status: 'OK',
      value: result,
    };
  }

  /**
   * Конвертирует ошибку в ResponseContext
   *
   * `Fail` — осознанно брошенная ошибка: message/details автор раскрыл сам,
   * поэтому они попадают в тело независимо от exposeErrorDetails.
   *
   * Любая другая ошибка считается необработанной (внутренней): по умолчанию
   * (`exposeErrorDetails === false`) клиенту уходит только generic-сообщение
   * без `message` и `stack`. Раскрытие включается явно окружением.
   */
  private errorToResponse(
    error: unknown,
    exposeErrorDetails: boolean,
  ): ResponseContext<never> {
    if (error instanceof Fail) {
      const errorValue: ErrorDetails = {
        error: error.message,
      };

      if (error.details !== undefined) {
        errorValue.details = error.details;
      }

      return {
        isSuccess: false,
        status: error.status,
        value: errorValue,
      };
    }

    const errorValue: ErrorDetails = {
      error: exposeErrorDetails
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'Internal server error',
    };

    if (exposeErrorDetails && error instanceof Error && error.stack) {
      errorValue.stack = error.stack;
    }

    return {
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: errorValue,
    };
  }
}

/**
 * Создаёт билдер одного слоя pipeline.
 *
 * @param TReq - требования слоя к внешнему контексту; проверяются
 * компилятором в точке композиции (`compose`)
 *
 * @example
 * ```typescript
 * const base = makePipeline().pre(withRequestId()).pre(validate());
 * const authed = makePipeline<{ requestId: string }>()
 *   .pre(withIdentity(verifyToken))
 *   .catch(mapAuthError);
 * const pipeline = compose(base, authed);
 * ```
 */
export function makePipeline<
  TReq extends AnyInput = EmptyInput,
>(): PipelineBuilder<TReq, TReq, never> {
  return PipelineImpl.emptyLayer() as unknown as PipelineBuilder<
    TReq,
    TReq,
    never
  >;
}

/**
 * Композиция слоёв: список читается сверху вниз как «снаружи внутрь».
 * Pre-тракты исполняются снаружи внутрь, ответные фазы и finally —
 * изнутри наружу. Требования каждого слоя к внешнему контексту
 * проверяются компилятором в точке композиции.
 */
export function compose<A extends AnyPipeline, B extends AnyPipeline>(
  outer: A,
  inner: ValidateCompose<A, B> & B,
): ComposeResult<A, B>;
export function compose<
  A extends AnyPipeline,
  B extends AnyPipeline,
  C extends AnyPipeline,
>(
  outer: A,
  middle: ValidateCompose<A, B> & B,
  inner: ValidateCompose<ComposeResult<A, B>, C> & C,
): ComposeResult<ComposeResult<A, B>, C>;
export function compose<
  A extends AnyPipeline,
  B extends AnyPipeline,
  C extends AnyPipeline,
  D extends AnyPipeline,
>(
  a: A,
  b: ValidateCompose<A, B> & B,
  c: ValidateCompose<ComposeResult<A, B>, C> & C,
  d: ValidateCompose<ComposeResult<ComposeResult<A, B>, C>, D> & D,
): ComposeResult<ComposeResult<ComposeResult<A, B>, C>, D>;
export function compose(...pipelines: AnyPipeline[]): AnyPipeline {
  if (pipelines.length < 2) {
    throw new Error('compose() expects at least two layers');
  }
  return PipelineImpl.compose(
    pipelines as unknown as PipelineImpl[],
  ) as unknown as AnyPipeline;
}
