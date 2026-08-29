import type { RequestCell } from './context/store.js';
import {
  iterateInScope,
  makeCell,
  runInScope,
  setPhase,
  updateInput,
} from './context/store.js';
import type { AnyContextVar } from './context/variable.js';
import { declaredVarOf, isContextVar } from './context/variable.js';
import { bindOutputStream, isAsyncIterable, withFinish } from './io/index.js';
import type {
  EndpointMeta,
  ErrorDetails,
  ErrorResponseContext,
  ExtendableContext,
  ResponseContext,
} from './types/context.js';
import type {
  AnyAddition,
  CatchUnitFn,
  FinallyUnitFn,
  OkUnitFn,
  Outcome,
  PreUnitFn,
  ResponseTrackInput,
  UnitInstance,
  UnitLike,
} from './types/unit.js';
import { computeOutcome } from './abort.js';

import type { Constructor } from '@common/misc';
import type {
  AnyFail,
  AnyInput,
  EmptyInput,
  FailData,
  Output,
  OutputSync,
} from '@nestling/contracts';
import {
  describeForm,
  isFail,
  isKernelFailCode,
  isStreamKind,
  Ok,
  UnknownError,
} from '@nestling/contracts';

/**
 * Ошибка, которая произошла после начала отдачи потокового ответа.
 *
 * Заголовки к этому моменту уже отправлены, и статус изменить нельзя.
 * Поэтому наружу уходит не исходная ошибка, а готовый контекст ответа
 * `response`: транспорт собирает из него кадр ошибки (`event: error` для
 * SSE) или обрывает соединение (NDJSON). Исходная ошибка уже передана в
 * `onUnknownFail`.
 */
export class MidStreamFailure extends Error {
  constructor(
    public readonly response: ErrorResponseContext,
    options?: { cause?: unknown },
  ) {
    super(response.value.error, options);
    this.name = 'MidStreamFailure';
  }
}

/** Проверяет, что значение — `MidStreamFailure` */
export function isMidStreamFailure(value: unknown): value is MidStreamFailure {
  return value instanceof MidStreamFailure;
}

/**
 * Сведения об отказе, который не объявлен в `errors:` endpoint'а и
 * заменён на `UnknownError`.
 *
 * Клиент получает только общее тело ответа; исходная ошибка целиком
 * передаётся сюда.
 */
export interface UnknownFailInfo {
  /** Исходный отказ или необработанная ошибка */
  error: unknown;

  /** Метаданные endpoint'а: транспорт, паттерн, объявленные отказы */
  endpoint: EndpointMeta;
}

/**
 * Опции выполнения пайплайна.
 *
 * Опции передаются при вызове, а не хранятся в пайплайне: один пайплайн
 * переиспользуется, а политика раскрытия ошибок принадлежит окружению
 * (транспорту или приложению).
 */
export interface ExecuteOptions {
  /**
   * Показывать ли клиенту `message` и `stack` необработанных ошибок
   * (не `Fail`). По умолчанию `false`: в тело уходит только общее
   * сообщение.
   */
  exposeErrorDetails?: boolean;

  /**
   * Хук для отказов, не объявленных в `errors:`. По умолчанию —
   * `console.error`, чтобы такой отказ не терялся молча.
   */
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Хук `onUnknownFail` по умолчанию: пишет в `console.error` endpoint, код
 * отказа и подсказку добавить его в `errors:`.
 */
function reportUnknownFail(info: UnknownFailInfo): void {
  const code = isFail(info.error) ? info.error.code : undefined;
  const what = code ? `fail '${code}'` : 'unhandled error';

  // eslint-disable-next-line no-console
  console.error(
    `[nestling] ${info.endpoint.transport} ${info.endpoint.pattern}: ` +
      `undeclared ${what} normalized to '${UnknownError.code}'. ` +
      `Declare it in 'errors:' or handle it in a .catch unit.`,
    info.error,
  );
}

type OverlapKeys<A, B> = keyof A & keyof B;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ---------------------------------------------------------------------------
// Типы-ошибки
//
// Каждый тип-ошибка обёрнут в `Simplify<…>` внутри алиаса. Без обёртки
// TypeScript печатает именованный дженерик-алиас его именем
// (`ComposeError<…>`), и текст `__error` в диагностике пропадает. Обёртка —
// часть контракта диагностики; её проверяют снапшоты в `type-tests/`.
// ---------------------------------------------------------------------------

/**
 * Поля `Required`, которых нет в `Provided`, в виде записи «имя поля: тип».
 *
 * Сюда попадают и поля, которые в `Provided` есть, но с несовместимым
 * типом. Простой юнион ключей (`Exclude<keyof Required, keyof Provided>`)
 * такие поля терял, и сообщение не называло причину.
 */
export type MissingFields<Provided, Required> = Simplify<{
  [K in keyof Required as K extends keyof Provided
    ? [Provided[K]] extends [Required[K]]
      ? never
      : K
    : K]: Required[K];
}>;

/**
 * Поля, у которых типы в `A` и `B` различаются, в виде записи
 * «имя поля: [было, стало]».
 */
type ConflictingFields<A, B> = Simplify<{
  [K in OverlapKeys<A, B> as [A[K], B[K]] extends [B[K], A[K]] ? never : K]: [
    A[K],
    B[K],
  ];
}>;

/** Тип-ошибка точки композиции */
type ComposeError<Provided, Required> = Simplify<{
  __error: 'Layer requires context that outer layers do not provide';
  missing: MissingFields<Provided, Required>;
}>;

/** Тип-ошибка `.pre`: накопленный `input` не покрывает требования юнита */
type PreRequirementError<TCurrentInput, TReq> = Simplify<{
  __error: 'Pre-unit requires context that the accumulated input does not provide';
  missing: MissingFields<TCurrentInput, TReq>;
}>;

/** Тип-ошибка `.pre`: юнит перезаписывает уже накопленное поле */
type PreConflictError<TCurrentInput, TAdd> = Simplify<{
  __error: 'Pre-unit overrides fields that are already in the input';
  conflicting: ConflictingFields<TCurrentInput, TAdd>;
}>;

/**
 * Общие ключи `A` и `B`, у которых типы различаются.
 *
 * Повторное добавление поля с тем же типом (например, два `withTiming` в
 * одной цепочке) конфликтом не считается: `input` от этого не меняется.
 */
type ConflictingKeys<A, B> = {
  [K in OverlapKeys<A, B>]: [A[K], B[K]] extends [B[K], A[K]] ? never : K;
}[OverlapKeys<A, B>];

/**
 * Проверяет, что требования `TReq` и добавка `TAdd` юнита совместимы с
 * накопленным `input`. Возвращает `M`, если да, и тип-ошибку, если нет.
 * `TAdd` нормализуется до проверки: юнит без добавки (`undefined`, `never`)
 * ни с чем не конфликтует.
 */
type CheckPreCompatibility<TCurrentInput, TReq, TAdd, M> = [
  TCurrentInput,
] extends [TReq]
  ? [ConflictingKeys<TCurrentInput, NormalizeAddition<TAdd>>] extends [never]
    ? M
    : PreConflictError<TCurrentInput, NormalizeAddition<TAdd>>
  : PreRequirementError<TCurrentInput, TReq>;

/**
 * Проверяет совместимость `.pre`-юнита любой из трёх форм (функция,
 * инстанс, класс) с накопленным `input`.
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
 * Приводит добавку юнита к объекту: `undefined` и `never` становятся `{}`,
 * чтобы юнит без добавки не менял тип пайплайна.
 */
type NormalizeAddition<TAdd> = [TAdd] extends [never]
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}
  : TAdd extends AnyAddition
    ? TAdd
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

/** Добавка `.pre`-юнита любой формы, приведённая к объекту */
type ExtractAddition<M> =
  M extends Constructor<UnitInstance<PreUnitFn<any, infer TAdd>>>
    ? NormalizeAddition<TAdd>
    : M extends PreUnitFn<any, infer TAdd>
      ? NormalizeAddition<TAdd>
      : M extends UnitInstance<PreUnitFn<any, infer TAdd>>
        ? NormalizeAddition<TAdd>
        : never;

/**
 * Отложенная зависимость юнита: для класс-формы это её конструктор,
 * для остальных форм — `never`.
 */
type ExtractNeeds<M> = M extends Constructor<UnitInstance<any>> ? M : never;

/**
 * Тип-параметры пайплайна в виде объекта. Существует только в типах:
 * по нему `compose` и вспомогательные типы выводят параметры.
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

/** Создаёт инстанс класса-юнита для `bind()`; обычно это контейнер */
export type UnitResolver = (ctor: Constructor<unknown>) => unknown;

/**
 * Пайплайн: иммутабельное значение, которое умеет выполнить запрос.
 *
 * @template TReq - Требования слоя к внешнему контексту. Задаются
 * `makePipeline<TReq>()` и проверяются компилятором в `compose`
 * @template TAcc - `input`, накопленный `.pre`-юнитами (включает `TReq`)
 * @template TNeeds - Классы-юниты, которым ещё нужен инстанс. `never` —
 * пайплайн готов к выполнению; иначе нужен `bind()` (`App` вызывает его
 * на фазе WIRE)
 */
export interface Pipeline<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> {
  /** @internal Существует только в типах; по нему выводятся параметры */
  readonly $types?: PipelineTypes<TReq, TAcc, TNeeds>;

  /**
   * Создаёт инстансы классов-юнитов через `resolve` (обычно это контейнер)
   * и возвращает пайплайн, готовый к выполнению (`TNeeds = never`).
   */
  bind(resolve: UnitResolver): Pipeline<TReq, TAcc, never>;

  /**
   * Выполняет запрос: `.pre`-юниты, хендлер, `.ok`/`.catch`, проверку
   * `errors:` и `.finally`.
   *
   * Доступен только при `TNeeds = never`: у всех классов-юнитов есть
   * инстансы.
   *
   * @param handler - Хендлер endpoint'а; получает `payload` и `meta`
   * отдельными аргументами
   * @param ctx - Начальный контекст, собранный транспортом
   * @param options - Опции выполнения
   */
  executeWithHandler<TOutput>(
    this: Pipeline<TReq, TAcc, never>,
    handler: (
      payload: TAcc extends { payload: infer P } ? P : undefined,
      meta: (TAcc extends { payload: unknown }
        ? Omit<TAcc, 'payload'>
        : TAcc) & { signal: AbortSignal; fail: (e: AnyFail) => never },
    ) => OutputSync<TOutput, AnyFail> | Output<TOutput, AnyFail>,
    ctx: ExtendableContext<TAcc>,
    options?: ExecuteOptions,
  ): Promise<ResponseContext<TOutput>>;
}

/**
 * Пайплайн после первого `.ok`, `.catch` или `.finally`: метод `.pre`
 * больше недоступен, поэтому порядок чтения декларации совпадает с
 * порядком выполнения.
 */
export interface PhasedPipeline<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> extends Pipeline<TReq, TAcc, TNeeds> {
  /** Добавляет юнит для успешного ответа; юнит видит полный `ctx` */
  ok<M extends UnitLike<OkUnitFn<TAcc>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;

  /** Добавляет юнит для ответа-ошибки; поля своего слоя в `ctx` — `Partial` */
  catch<M extends UnitLike<CatchUnitFn<ResponseTrackInput<TReq, TAcc>>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;

  /** Добавляет наблюдатель исхода; вызывается всегда и последним */
  finally<M extends UnitLike<FinallyUnitFn<ResponseTrackInput<TReq, TAcc>>>>(
    unit: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>>;
}

/** Пайплайн, к которому ещё можно добавлять `.pre`-юниты */
export interface PipelineBuilder<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
> extends PhasedPipeline<TReq, TAcc, TNeeds> {
  /** Добавляет юнит до хендлера; его добавка расширяет `input` */
  pre<M extends UnitLike<PreUnitFn<any, any>>>(
    unit: ValidatePreUnit<TAcc, M>,
  ): PipelineBuilder<TReq, TAcc & ExtractAddition<M>, TNeeds | ExtractNeeds<M>>;
}

/**
 * Пайплайн с любыми тип-параметрами.
 *
 * В сигнатурах перегрузок `compose` не используется: один тип-параметр на
 * слой заставлял компилятор разворачивать всю цепочку на каждом уровне
 * вложенности (`type-tests/BUDGET.md`).
 */
export type AnyPipeline = Pipeline<any, any, any>;

/**
 * Проверяет в `compose`, что внешние слои дают всё, что требует внутренний
 * (`makePipeline<TReq>()`).
 *
 * При успехе — `Pipeline<R, A, N>`, из которого TypeScript выводит
 * тип-параметры внутреннего слоя. При ошибке — только литерал ошибки, без
 * пересечения с типом слоя: иначе первая строка диагностики продолжалась
 * бы хвостом `& PipelineBuilder<...>`.
 */
type Guard<Provided, R extends AnyInput, A extends AnyInput, N> = [
  Provided,
] extends [R]
  ? Pipeline<R, A, N>
  : ComposeError<Provided, R>;

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

type AnyUnitFn = (...args: unknown[]) => unknown;

interface UnitEntry {
  /** Готовая к вызову функция юнита (или `handle` инстанса с `bind`) */
  fn?: AnyUnitFn;
  /** Класс юнита, пока `bind()` не создал инстанс */
  ctor?: Constructor<UnitInstance<AnyUnitFn>>;
}

type ResponsePhase = 'ok' | 'catch';

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
    // У класса-юнита есть handle в прототипе; обычная функция — сама юнит
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
 * Возвращает функцию юнита. Ошибка недостижима после проверки классов без
 * инстансов в `execute`; она страхует от рассинхрона двух проверок.
 */
function materialized(entry: UnitEntry): AnyUnitFn {
  if (!entry.fn) {
    throw new Error('Pipeline unit is not materialized; call bind() first');
  }
  return entry.fn;
}

/**
 * Единственная реализация пайплайна. Наружу отдаётся под типами
 * `Pipeline`, `PhasedPipeline` и `PipelineBuilder`; порядок методов
 * держат типы, а проверки в рантайме повторяют его для JS-потребителей.
 */
class PipelineImpl {
  constructor(
    private readonly layers: Layer[],
    /** `true` после первого `.ok`/`.catch`/`.finally`: `.pre` закрыт */
    private readonly sealed: boolean,
    /** `true` для результата `compose`: юниты добавлять нельзя */
    private readonly composed = false,
    /**
     * Значения, из которых получен этот пайплайн.
     *
     * `compose` копирует слои, поэтому по `layers` исходное значение не
     * восстановить; происхождение хранится явно. В выполнении не
     * участвует: его читает только {@link PipelineImpl.derivesFrom}, на
     * котором держится политика `hasLayer`.
     */
    private readonly sources: readonly PipelineImpl[] = [],
    /**
     * Контекстные переменные, объявленные `.pre`-юнитами этого пайплайна.
     *
     * Правила те же, что у `sources`: `compose` объединяет множества,
     * методы билдера и `bind()` их сохраняют. В выполнении не участвует:
     * его читает только {@link PipelineImpl.declaresVar} (политика
     * `hasVar`).
     */
    private readonly declared: ReadonlySet<AnyContextVar> = new Set(),
  ) {}

  static emptyLayer(): PipelineImpl {
    return new PipelineImpl([{ pre: [], responses: [], finals: [] }], false);
  }

  static compose(pipelines: PipelineImpl[]): PipelineImpl {
    return new PipelineImpl(
      pipelines.flatMap((p) => p.layers.map(cloneLayer)),
      true,
      true,
      // Только сами аргументы: транзитивность обеспечивает обход в
      // `derivesFrom`, а не запись
      [...pipelines],
      // Переменные, наоборот, объединяются здесь: `declaresVar` обход не
      // делает
      new Set(pipelines.flatMap((p) => [...p.declared])),
    );
  }

  /**
   * Проверяет, что `layer` встречается среди источников `pipeline`:
   * обход графа происхождения в ширину, сравнение по ссылке.
   *
   * Стартовый узел входит в обход: endpoint с `pipeline: authedBase`
   * содержит `authedBase`. Множество посещённых обязательно: одно значение
   * может встречаться в нескольких ветках композиции.
   */
  static derivesFrom(pipeline: PipelineImpl, layer: PipelineImpl): boolean {
    const queue: PipelineImpl[] = [pipeline];
    const visited = new Set<PipelineImpl>(queue);

    // Итератор массива видит элементы, добавленные во время обхода,
    // поэтому массив работает как очередь
    for (const node of queue) {
      if (node === layer) {
        return true;
      }

      for (const source of node.sources) {
        if (!visited.has(source)) {
          visited.add(source);
          queue.push(source);
        }
      }
    }

    return false;
  }

  /**
   * Проверяет, что `pipeline` объявил переменную `variable` (сравнение по
   * ссылке). Обход источников не нужен: множества объединены в `compose`.
   */
  static declaresVar(pipeline: PipelineImpl, variable: AnyContextVar): boolean {
    return pipeline.declared.has(variable);
  }

  private withOwnLayer(
    mutate: (layer: Layer) => void,
    sealed: boolean,
    declares?: AnyContextVar,
  ): PipelineImpl {
    if (this.composed) {
      throw new Error(
        'Cannot add units to a composed pipeline; add them to a layer before compose()',
      );
    }
    // Builder всегда владеет ровно одним слоем
    const layer = cloneLayer(this.layers[0]);
    mutate(layer);
    // Новое множество нужно только при добавлении; иначе прежнее
    // разделяется по ссылке, менять его некому
    const declared = declares
      ? new Set([...this.declared, declares])
      : this.declared;

    // Новый пайплайн помнит предшественника: `authed.pre(x)` для политики
    // `hasLayer(authed)` по-прежнему содержит `authed`
    return new PipelineImpl([layer], sealed, false, [this], declared);
  }

  pre(unit: unknown): PipelineImpl {
    if (this.sealed) {
      throw new Error(
        'pre() is not available after a response-phase method (.ok/.catch/.finally)',
      );
    }
    // Объявителем переменной считается только юнит из `<Var>.provide(…)`
    return this.withOwnLayer(
      (l) => l.pre.push(normalizeUnit(unit)),
      false,
      declaredVarOf(unit),
    );
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
      // Пайплайн с инстансами помнит оригинал без них: `hasLayer` работает
      // и до фазы WIRE, и после
      [this],
      this.declared,
    );
  }

  /**
   * Открывает область асинхронного контекста на всё выполнение запроса:
   * `.pre`-юниты, хендлер, `.ok`/`.catch`, проверку `errors:` и `.finally`.
   *
   * Область открывается всегда, даже если в приложении нет ни одного
   * читателя `Ctx`: цена — одна ячейка и `als.run` на запрос, зато рантайм
   * пайплайна не зависит от сборки графа.
   */
  async executeWithHandler(
    handler: (payload: unknown, meta: AnyAddition) => unknown,
    ctx: ExtendableContext<AnyInput>,
    options: ExecuteOptions = {},
  ): Promise<ResponseContext<unknown>> {
    const cell = makeCell(ctx.signal, ctx.input);

    return runInScope(cell, () => this.execute(cell, handler, ctx, options));
  }

  private async execute(
    cell: RequestCell,
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
    const onUnknownFail = options.onUnknownFail ?? reportUnknownFail;

    let currentCtx: ExtendableContext<AnyInput> = ctx;
    let response: ResponseContext<unknown>;
    const activated: Layer[] = [];

    /**
     * Исходная ошибка текущего ответа-ошибки: `enforceContract` передаёт
     * её хуку целиком. В самом ответе остаётся только то, что можно
     * показать клиенту.
     */
    let originalError: unknown;

    try {
      // `.pre`-юниты слоёв, снаружи внутрь. Слой активирован с первого
      // своего `.pre`-юнита: его `.ok`/`.catch`/`.finally` выполнятся.
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

          // Ячейка контекста обновляется после каждого юнита: сервис,
          // вызванный следующим юнитом, читает через `Ctx` тот же `input`
          updateInput(cell, currentCtx.input);
        }
      }

      const finalInput = currentCtx.input;
      const { payload, ...meta } = finalInput as AnyAddition & {
        payload?: unknown;
      };

      // Без `validate()` в `.pre` хендлер получает сырой payload от
      // транспорта
      const effectivePayload =
        'payload' in finalInput ? payload : ctx.raw.payload;

      setPhase(cell, 'handler');

      // Ключи `signal` и `fail` зарезервированы: значения пайплайна
      // перекрывают одноимённые поля из `.pre`-юнитов
      const result = await handler(effectivePayload, {
        ...meta,
        signal: ctx.signal,
        fail: throwFail,
      });

      // Возвращённый `Fail` обрабатывается как брошенный: `.ok`-юниты не
      // выполняются ни в одном из двух случаев
      if (isFail(result)) {
        originalError = result;
        response = this.errorToResponse(result, exposeErrorDetails);
      } else {
        response = this.normalizeResponse(result, ctx);
      }
    } catch (error) {
      originalError = error;
      response = this.errorToResponse(error, exposeErrorDetails);
    }

    setPhase(cell, 'response');

    // `.ok`/`.catch`: активированные слои изнутри наружу, юниты слоя в
    // порядке объявления. Юнит выполняется, если подходит текущему ответу.
    const innerToOuter = [...activated].reverse();
    for (const layer of innerToOuter) {
      for (const entry of layer.responses) {
        const applicable = (entry.phase === 'ok') === response.isSuccess;
        if (!applicable) {
          continue;
        }

        try {
          const replaced = (await materialized(entry)(response, currentCtx)) as
            | ResponseContext<unknown>
            | AnyFail
            | undefined;
          if (replaced !== undefined && replaced !== null) {
            // `.catch` может вернуть просто `Fail`; он нормализуется так
            // же, как отказ хендлера
            if (isFail(replaced)) {
              originalError = replaced;
              response = this.errorToResponse(replaced, exposeErrorDetails);
            } else {
              originalError = replaced.isSuccess ? undefined : replaced;
              response = replaced;
            }
          }
        } catch (error) {
          // Исключение из `.ok`/`.catch` — необработанная ошибка: ответ
          // заменяется, остальные юниты продолжают
          originalError = error;
          response = this.errorToResponse(error, exposeErrorDetails);
        }
      }
    }

    // Проверка `errors:` стоит после `.catch` (там незадекларированный
    // отказ ещё можно превратить в задекларированный) и до `.finally`
    // (наблюдатель видит тот ответ, который уйдёт клиенту)
    response = this.enforceContract(
      response,
      originalError,
      ctx.endpoint,
      exposeErrorDetails,
      onUnknownFail,
    );

    // `.finally`: изнутри наружу, всегда. Исключения наблюдателей на ответ
    // не влияют; юнит обрабатывает свои ошибки сам
    const runFinals = async (
      outcome: Outcome,
      settled: ResponseContext<unknown>,
    ): Promise<void> => {
      for (const layer of innerToOuter) {
        for (const entry of layer.finals) {
          try {
            await materialized(entry)(outcome, settled, currentCtx);
          } catch {
            // намеренно: `.finally` — наблюдатель, его ошибки ответ не меняют
          }
        }
      }
    };

    // Потоковый ответ: исход известен только после доставки, поэтому
    // `.finally` откладывается до закрытия итератора. Транспорт обязан
    // дочитать итератор или закрыть его через `return()`
    if (
      response.isSuccess &&
      isStreamKind(describeForm(ctx.endpoint.output).kind) &&
      isAsyncIterable(response.value)
    ) {
      const delivered = response;

      // У шагов потока своя фаза: тело генератора выполняется уже после
      // возврата итератора
      setPhase(cell, 'stream');

      const stream = withFinish(
        response.value as AsyncIterable<unknown>,
        async (error) => {
          if (error === undefined) {
            await runFinals(computeOutcome(ctx.signal, delivered), delivered);
            return;
          }

          // Та же проверка `errors:` и тот же хук, что на обычном пути
          const failure = this.enforceContract(
            this.errorToResponse(error, exposeErrorDetails),
            error,
            ctx.endpoint,
            exposeErrorDetails,
            onUnknownFail,
          ) as ErrorResponseContext;

          await runFinals(computeOutcome(ctx.signal, delivered, true), failure);

          return new MidStreamFailure(failure, { cause: error });
        },
      );

      // Область контекста — самая внешняя обёртка: в ней выполняются и
      // шаги потока, и `.finally`-юниты после его завершения
      return {
        ...delivered,
        value: iterateInScope(cell, stream),
      } as ResponseContext<unknown>;
    }

    setPhase(cell, 'finally');

    await runFinals(computeOutcome(ctx.signal, response), response);

    return response;
  }

  /**
   * Превращает результат хендлера в `ResponseContext`.
   *
   * При потоковой форме `output` возвращённый `AsyncIterable` оборачивается
   * здесь: сначала выходная item-цепочка, затем валидация каждого элемента
   * схемой, затем счётчик `itemsOut`. Транспорт получает готовый итератор
   * и только упаковывает элементы в кадры.
   */
  private normalizeResponse<T>(
    result: T,
    ctx: ExtendableContext<AnyInput>,
  ): ResponseContext<T> {
    const base: ResponseContext<T> =
      result instanceof Ok
        ? {
            isSuccess: true,
            status: result.status,
            value: result.value as T,
            headers: result.headers,
          }
        : {
            isSuccess: true,
            status: 'OK',
            value: result,
          };

    const form = describeForm(ctx.endpoint.output);
    if (!isStreamKind(form.kind) || !isAsyncIterable(base.value)) {
      return base;
    }

    return {
      ...base,
      value: bindOutputStream(form, base.value, ctx) as T,
    };
  }

  /**
   * Превращает ошибку в `ErrorResponseContext`.
   *
   * Отказ (`Fail` или десериализованное значение с `isFail`) автор
   * написал сам, поэтому его `message`, `code` и `details` попадают в тело
   * независимо от `exposeErrorDetails`. Незадекларированный отказ позже
   * заменит `enforceContract`.
   *
   * Любая другая ошибка считается внутренней: по умолчанию клиенту уходит
   * только общее сообщение, без `message` и `stack`.
   */
  private errorToResponse(
    error: unknown,
    exposeErrorDetails: boolean,
  ): ErrorResponseContext {
    if (isFail(error)) {
      const errorValue: ErrorDetails = {
        error: typeof error.message === 'string' ? error.message : 'Error',
      };

      if (error.code !== undefined) {
        errorValue.code = error.code;
      }

      if (error.details !== undefined) {
        errorValue.details = error.details;
      }

      return {
        isSuccess: false,
        status: error.status ?? 'INTERNAL_ERROR',
        value: errorValue,
      };
    }

    return {
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: unhandledBody(error, exposeErrorDetails),
    };
  }

  /**
   * Проверяет ответ-ошибку по `errors:` endpoint'а.
   *
   * Ответ проходит, если его код объявлен в `errors:` или является кодом
   * ядра. Любой другой ответ, включая ответ без кода (анонимный `Fail.*`,
   * необработанная ошибка), заменяется на `UnknownError`; исходная ошибка
   * передаётся в `onUnknownFail`.
   */
  private enforceContract(
    response: ResponseContext<unknown>,
    originalError: unknown,
    endpoint: EndpointMeta,
    exposeErrorDetails: boolean,
    onUnknownFail: (info: UnknownFailInfo) => void,
  ): ResponseContext<unknown> {
    if (response.isSuccess) {
      return response;
    }

    const code = response.value.code;
    const declared =
      code !== undefined &&
      (endpoint.errors ?? []).some((definition) => definition.code === code);

    if (declared || isKernelFailCode(code)) {
      return response;
    }

    // Исходной ошибки может не быть (ответ собрал `.catch`-юнит вручную);
    // тогда хук получает сам ответ
    onUnknownFail({ error: originalError ?? response, endpoint });

    // Тело как у необработанной ошибки: детали незадекларированного отказа
    // клиенту не уходят
    return {
      isSuccess: false,
      status: UnknownError.status,
      value: {
        ...unhandledBody(originalError, exposeErrorDetails),
        code: UnknownError.code,
      },
    };
  }
}

/**
 * Тело ответа на необработанную ошибку: общее сообщение, а `message` и
 * `stack` оригинала — только при `exposeErrorDetails`.
 */
function unhandledBody(
  error: unknown,
  exposeErrorDetails: boolean,
): ErrorDetails {
  const body: ErrorDetails = {
    error: exposeErrorDetails
      ? error instanceof Error
        ? error.message
        : 'Unknown error'
      : 'Internal server error',
  };

  if (exposeErrorDetails && error instanceof Error && error.stack) {
    body.stack = error.stack;
  }

  return body;
}

/**
 * Реализация `meta.fail`: бросает переданный отказ.
 *
 * Проверка `isFail` нужна JS-потребителям, которых не сдерживают типы:
 * `meta.fail('boom')` падает понятным `TypeError`, а не уходит строкой в
 * ответ.
 */
function throwFail(error: AnyFail | FailData): never {
  if (!isFail(error)) {
    throw new TypeError(
      'meta.fail(e) expects a Fail value (create one with defineFail), ' +
        `got ${typeof error}.`,
    );
  }
  throw error;
}

/**
 * Создаёт пайплайн из одного слоя.
 *
 * @template TReq - Требования слоя к внешнему контексту; их проверяет
 * компилятор в `compose`
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
 * Складывает слои в один пайплайн. Список читается сверху вниз как
 * «снаружи внутрь»: `.pre`-юниты выполняются снаружи внутрь,
 * `.ok`/`.catch` и `.finally` — изнутри наружу. Требования каждого слоя к
 * внешнему контексту проверяет компилятор.
 */
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
>(
  outer: Pipeline<RA, AA, NA>,
  inner: Guard<AA, RB, AB, NB>,
): Pipeline<RA, AA & AB, NA | NB>;
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
  RC extends AnyInput,
  AC extends AnyInput,
  NC,
>(
  outer: Pipeline<RA, AA, NA>,
  middle: Guard<AA, RB, AB, NB>,
  inner: Guard<AA & AB, RC, AC, NC>,
): Pipeline<RA, AA & AB & AC, NA | NB | NC>;
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
  RC extends AnyInput,
  AC extends AnyInput,
  NC,
  RD extends AnyInput,
  AD extends AnyInput,
  ND,
>(
  a: Pipeline<RA, AA, NA>,
  b: Guard<AA, RB, AB, NB>,
  c: Guard<AA & AB, RC, AC, NC>,
  d: Guard<AA & AB & AC, RD, AD, ND>,
): Pipeline<RA, AA & AB & AC & AD, NA | NB | NC | ND>;
export function compose(...pipelines: AnyPipeline[]): AnyPipeline {
  if (pipelines.length < 2) {
    throw new Error('compose() expects at least two layers');
  }
  return PipelineImpl.compose(
    pipelines as unknown as PipelineImpl[],
  ) as unknown as AnyPipeline;
}

/**
 * Проверяет, что `pipeline` содержит слой `layer`.
 *
 * Слои сравниваются по ссылке, а не по имени, юнитам или структуре.
 * Отношение транзитивно (`compose(compose(base, authed), extra)` содержит
 * все три слоя) и рефлексивно (пайплайн содержит сам себя).
 *
 * @internal На этой функции построена политика
 * `everyEndpoint(...).hasLayer(...)`
 */
export function derivesFrom(pipeline: unknown, layer: unknown): boolean {
  if (!(pipeline instanceof PipelineImpl) || !(layer instanceof PipelineImpl)) {
    return false;
  }

  return PipelineImpl.derivesFrom(pipeline, layer);
}

/**
 * Проверяет, что `pipeline` объявил контекстную переменную `variable`.
 *
 * Объявлением считается только `.pre`-юнит вида `<Var>.provide(…)`. Юнит,
 * который кладёт то же поле обычной функцией, работает (читатели видят
 * поле через `Ctx`), но объявлением не считается. Переменные сравниваются
 * по ссылке: одноимённая переменная из другого вызова `contextVar` —
 * другое значение.
 *
 * @internal На этой функции построена политика
 * `everyEndpoint(...).hasVar(...)`
 */
export function declaresVar(pipeline: unknown, variable: unknown): boolean {
  if (!(pipeline instanceof PipelineImpl) || !isContextVar(variable)) {
    return false;
  }

  return PipelineImpl.declaresVar(pipeline, variable);
}
