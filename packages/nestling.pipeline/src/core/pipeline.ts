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
import {
  bindOutputStream,
  describeForm,
  isAsyncIterable,
  isStreamKind,
  withFinish,
} from './io/index.js';
import type { AnyInput, EmptyInput } from './io/io.js';
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
import { isKernelFailCode, UnknownError } from './kernel-fails.js';
import type { AnyFail, FailData, Output, OutputSync } from './result.js';
import { isFail, Ok } from './result.js';

import type { Constructor } from '@common/misc';

/**
 * Отказ, возникший **после начала отдачи** потокового ответа.
 *
 * Заголовки уже ушли, статус сменить нельзя — поэтому наружу летит не
 * оригинал, а нормализованный контекст ответа: транспорт из него собирает
 * mid-stream кадр (`event: error` для SSE) или обрывает соединение
 * (NDJSON). Оригинал к этому моменту уже ушёл в `onUnknownFail`.
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

/** Значение — mid-stream отказ, несущий готовое тело ответа */
export function isMidStreamFailure(value: unknown): value is MidStreamFailure {
  return value instanceof MidStreamFailure;
}

/**
 * Диагностика незадекларированного отказа, снятого стражем границы.
 *
 * Оригинал уходит сюда целиком — клиенту достаётся generic-тело.
 */
export interface UnknownFailInfo {
  /** Исходный отказ или необработанная ошибка */
  error: unknown;

  /** Метаданные ручки: транспорт, паттерн, объявленные отказы */
  endpoint: EndpointMeta;
}

/**
 * Опции выполнения pipeline.
 *
 * exposeErrorDetails — раскрывать ли клиенту детали НЕобработанных ошибок
 * (не `Fail`): `error.message` и `stack`. По умолчанию `false` — в тело
 * уходит только generic-сообщение. Политика раскрытия — свойство окружения
 * (транспорт/приложение), поэтому передаётся при вызове, а не хранится в
 * самом (переиспользуемом) Pipeline.
 *
 * onUnknownFail — диагностический хук стража границы. Дефолт —
 * `console.error`: молчаливое проглатывание хуже шумного лога, а логгера
 * в ядре нет по принципу минимума зависимостей.
 */
export interface ExecuteOptions {
  exposeErrorDetails?: boolean;
  onUnknownFail?: (info: UnknownFailInfo) => void;
}

/**
 * Дефолтный наблюдатель нормализации: называет ручку, код и подсказывает
 * `errors:` — забытая декларация не должна выглядеть загадочным 500.
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
// Форма типов-ошибок
//
// Тип-ошибка обязана быть **анонимным развёрнутым литералом в точке
// печати**: именованный дженерик-алиас TypeScript печатает именем
// (`ComposeError<…>`), и текст сообщения пропадает. Разворачивание даёт
// `Simplify<…>` вокруг самого литерала, внутри алиаса — поэтому обёртка
// здесь часть контракта диагностики, а не косметика. Исполнимая проверка
// правила — снапшоты в `type-tests/`.
// ---------------------------------------------------------------------------

/**
 * Недостающий контекст как **рекорд «имя поля → его тип»**.
 *
 * В результат попадают и поля, которых во внешнем контексте нет, и поля,
 * которые есть, но несовместимого типа: второй случай юнион ключей
 * (`Exclude<keyof Required, keyof Provided>`) схлопывал в `never`, и
 * сообщение переставало называть причину.
 */
export type MissingFields<Provided, Required> = Simplify<{
  [K in keyof Required as K extends keyof Provided
    ? [Provided[K]] extends [Required[K]]
      ? never
      : K
    : K]: Required[K];
}>;

/**
 * Конфликтующие поля как рекорд «имя поля → [было, стало]»
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

/** Тип-ошибка pre-тракта: накопленный input не покрывает требования юнита */
type PreRequirementError<TCurrentInput, TReq> = Simplify<{
  __error: 'Pre-unit requires context that the accumulated input does not provide';
  missing: MissingFields<TCurrentInput, TReq>;
}>;

/** Тип-ошибка pre-тракта: юнит перезаписывает уже накопленное поле */
type PreConflictError<TCurrentInput, TAdd> = Simplify<{
  __error: 'Pre-unit overrides fields that are already in the input';
  conflicting: ConflictingFields<TCurrentInput, TAdd>;
}>;

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
    : PreConflictError<TCurrentInput, NormalizeAddition<TAdd>>
  : PreRequirementError<TCurrentInput, TReq>;

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
        : TAcc) & { signal: AbortSignal; fail: (e: AnyFail) => never },
    ) => OutputSync<TOutput, AnyFail> | Output<TOutput, AnyFail>,
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

/**
 * Пайплайн с любыми тип-параметрами.
 *
 * Остаётся публичным типом (им пользуются рантайм-сигнатура `compose` и
 * внешний код), но **из сигнатур перегрузок ушёл**: слой одним
 * тип-параметром заставлял компилятор переразворачивать всю цепочку на
 * каждом уровне вложенности — см. `type-tests/BUDGET.md`.
 */
export type AnyPipeline = Pipeline<any, any, any>;

/**
 * Проверка точки композиции: внешние слои должны предоставлять всё,
 * что требует внутренний (`makePipeline<TReq>()`).
 *
 * В успешной ветке — `Pipeline<R, A, N>`, из которой TypeScript выводит
 * тип-параметры внутреннего слоя; в неуспешной — **только** литерал
 * ошибки, без пересечения с типом слоя: иначе первая строка диагностики
 * тащит хвост `& PipelineBuilder<...>`.
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
  /** Материализованный юнит (функция или связанный handle инстанса) */
  fn?: AnyUnitFn;
  /** Класс-форма: конструктор до резолва через bind() */
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
    /**
     * Ссылки на значения, из которых произошёл этот пайплайн, —
     * **единственный источник истины для идентичности слоя**.
     *
     * `compose` плющит и клонирует слои, поэтому по `layers` исходное
     * значение невосстановимо: провенанс заводится явно. В исполнении не
     * участвует — только в предикате принадлежности слоя
     * ({@link PipelineImpl.derivesFrom}), на котором стоит policy-check.
     */
    private readonly sources: readonly PipelineImpl[] = [],
    /**
     * Ambient-переменные, объявленные pre-юнитами этого пайплайна.
     *
     * Живёт рядом с провенансом и по тем же правилам: `compose` объединяет
     * множества, деривация билдера и `bind()` их сохраняют. В исполнении не
     * участвует — только в предикате `hasVar`
     * ({@link PipelineImpl.declaresVar}).
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
      // Сами аргументы, без разворачивания их провенанса: транзитивность —
      // дело обхода, а не записи
      [...pipelines],
      // Множества объявленных переменных, наоборот, объединяются здесь:
      // предикат обходить провенанс не должен
      new Set(pipelines.flatMap((p) => [...p.declared])),
    );
  }

  /**
   * Достижимость значения-слоя по провенансу: обход DAG в ширину со
   * ссылочным равенством.
   *
   * Стартовый узел включён — ручка с `pipeline: authedBase` содержит
   * `authedBase`. Защита от повторного посещения обязательна: одно и то же
   * значение легально встречается в нескольких ветках композиции.
   */
  static derivesFrom(pipeline: PipelineImpl, layer: PipelineImpl): boolean {
    const queue: PipelineImpl[] = [pipeline];
    const visited = new Set<PipelineImpl>(queue);

    // Итератор массива видит элементы, дописанные в ходе обхода: очередь
    // растёт по мере раскрытия провенанса
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
   * Пайплайн объявил ambient-переменную: множество из решения о писателе,
   * идентичность переменной — ссылочная.
   *
   * Обхода провенанса здесь нет и не нужно: множества объединяются в
   * момент композиции.
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
    // Иммутабельность: новое множество заводится только когда есть что
    // добавить, иначе разделяется ссылкой — менять его всё равно нечем
    const declared = declares
      ? new Set([...this.declared, declares])
      : this.declared;

    // Деривация помнит предшественника: pre-тракт монотонен, поэтому
    // `authed.pre(x)` для инварианта — по-прежнему `authed`
    return new PipelineImpl([layer], sealed, false, [this], declared);
  }

  pre(unit: unknown): PipelineImpl {
    if (this.sealed) {
      throw new Error(
        'pre() is not available after a response-phase method (.ok/.catch/.finally)',
      );
    }
    // Объявителем считается только юнит, созданный `<Var>.provide(…)`:
    // декларация привязана к форме, поэтому разойтись с фактом не может
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
      // Связанный пайплайн помнит несвязанный оригинал: инвариант держится
      // и до WIRE, и после
      [this],
      this.declared,
    );
  }

  /**
   * Открывает scope запроса вокруг **всего** исполнения ручки: pre-тракт,
   * хендлер, ответный тракт, страж контракта и `finally`.
   *
   * Scope открывается безусловно — приложением без единого ридера цена
   * (одна ячейка и `als.run` на запрос) платится ради простоты правила
   * «проекция есть всегда»: условное открытие связало бы рантайм пайплайна
   * со сборкой графа.
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
     * Оригинал, породивший текущий ответ-ошибку: страж отдаёт его хуку
     * целиком. Хранится отдельно от ответа, потому что в теле остаётся
     * только то, что можно показать клиенту.
     */
    let originalError: unknown;

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

          // Проекция догоняет pre-тракт: сервис, вызванный следующим
          // юнитом, видит ровно то же, что и сам юнит
          updateInput(cell, currentCtx.input);
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

      setPhase(cell, 'handler');

      // Ключи `signal` и `fail` зарезервированы: инъекция пайплайна
      // перекрывает одноимённые поля, добавленные pre-юнитом.
      const result = await handler(effectivePayload, {
        ...meta,
        signal: ctx.signal,
        fail: throwFail,
      });

      // Возврат отказа эквивалентен броску: ответный тракт видит ошибку,
      // и `.ok` не исполняется ни на одном из двух путей.
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

    // Ответный тракт: активированные слои изнутри наружу; юниты слоя —
    // в порядке объявления, по применимости к ТЕКУЩЕМУ ответу.
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
            // `.catch` вправе вернуть просто отказ — рантайм нормализует
            // его так же, как отказ хендлера.
            if (isFail(replaced)) {
              originalError = replaced;
              response = this.errorToResponse(replaced, exposeErrorDetails);
            } else {
              originalError = replaced.isSuccess ? undefined : replaced;
              response = replaced;
            }
          }
        } catch (error) {
          // Падение ответного юнита — необработанная ошибка: ответ
          // заменяется по общей политике, остальные юниты продолжают.
          originalError = error;
          response = this.errorToResponse(error, exposeErrorDetails);
        }
      }
    }

    // Страж контракта: после всего ответного тракта (`.catch` — легальное
    // место превращения недекларированного отказа в контрактный) и до
    // `.finally` (наблюдатель обязан видеть ровно тот ответ, который уйдёт
    // клиенту).
    response = this.enforceContract(
      response,
      originalError,
      ctx.endpoint,
      exposeErrorDetails,
      onUnknownFail,
    );

    // Finally: изнутри наружу, всегда. Ошибки наблюдателей не влияют
    // на ответ (юнит обязан обрабатывать свои ошибки сам).
    const runFinals = async (
      outcome: Outcome,
      settled: ResponseContext<unknown>,
    ): Promise<void> => {
      for (const layer of innerToOuter) {
        for (const entry of layer.finals) {
          try {
            await materialized(entry)(outcome, settled, currentCtx);
          } catch {
            // намеренно проглатывается: finally — наблюдатель
          }
        }
      }
    };

    // Потоковый ответ: исход честен только по факту доставки, поэтому
    // финализация откладывается до закрытия итератора. Контракт с
    // транспортом — потребить итератор либо закрыть его `return()`.
    if (
      response.isSuccess &&
      isStreamKind(describeForm(ctx.endpoint.output).kind) &&
      isAsyncIterable(response.value)
    ) {
      const delivered = response;

      // Шаги потока и его финализация — та же проекция, своя фаза: тело
      // ленивого генератора исполняется уже после возврата итератора
      setPhase(cell, 'stream');

      const stream = withFinish(
        response.value as AsyncIterable<unknown>,
        async (error) => {
          if (error === undefined) {
            await runFinals(computeOutcome(ctx.signal, delivered), delivered);
            return;
          }

          // Тот же страж и тот же диагностический хук, что на обычном
          // пути: mid-stream отказ не выпадает из модели ошибок
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

      // Обёртка scope'а — **самая внешняя**: под ячейкой исполняются и
      // шаги потока, и его финализация вместе с `finally`-юнитами
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
   * Нормализует результат handler'а в ResponseContext.
   *
   * При потоковой форме `output` возвращённый `AsyncIterable` оборачивается
   * здесь: шаги выходной item-цепочки → поэлементная валидация схемой-листом
   * → счётчик `itemsOut`. Транспорт получает готовый итератор и занимается
   * только framing'ом.
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
   * Конвертирует ошибку в ResponseContext
   *
   * Отказ (`Fail` или приехавшее данными значение с `isFail`) — осознанная
   * ошибка автора: message/code/details он раскрыл сам, поэтому они
   * попадают в тело независимо от exposeErrorDetails. Привилегия
   * раскрытия при этом достаётся только **задекларированному** отказу:
   * незадекларированный снимет страж границы.
   *
   * Любая другая ошибка считается необработанной (внутренней): по умолчанию
   * (`exposeErrorDetails === false`) клиенту уходит только generic-сообщение
   * без `message` и `stack`. Раскрытие включается явно окружением.
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
   * Страж контракта отказов.
   *
   * Ответ считается контрактным, только если несёт код, объявленный в
   * `errors:` ручки, либо kernel-код. Всё остальное — включая ответ вовсе
   * без кода (анонимный `Fail.*`, необработанная ошибка) — заменяется на
   * `UnknownError`: множество ответов ручки закрыто, warn-and-pass нет.
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

    // Оригинал мог не сохраниться (ответ собран `.catch`-юнитом руками) —
    // тогда хук получает сам ответ: терять диагностику нельзя.
    onUnknownFail({ error: originalError ?? response, endpoint });

    // Тело — то же, что у необработанной ошибки: незадекларированный отказ
    // привилегии раскрытия не имеет. `exposeErrorDetails` по-прежнему
    // управляет только показом внутренностей в доверенном окружении.
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
 * Тело ответа на необработанное: generic-сообщение по умолчанию, детали
 * оригинала — только при явно включённом раскрытии.
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
 * Бросатель `meta.fail`: вся сила в типе, рантайм тривиален.
 *
 * Проверка нужна для JS-потребителей, которых типы не сдерживают:
 * `meta.fail('boom')` должен падать понятным `TypeError`, а не уезжать
 * строкой в ответный тракт.
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
 * Пайплайн произошёл от значения-слоя.
 *
 * Идентичность слоя **ссылочная**: сравнения по имени, по идентичности
 * юнитов и по структуре слоёв не существует. Отношение транзитивно
 * (`compose(compose(base, authed), extra)` содержит все три) и рефлексивно
 * (пайплайн содержит сам себя).
 *
 * @internal основание предиката `hasLayer` словаря политик; наружу
 * поведение видно через `everyEndpoint(...).hasLayer(...)`
 */
export function derivesFrom(pipeline: unknown, layer: unknown): boolean {
  if (!(pipeline instanceof PipelineImpl) || !(layer instanceof PipelineImpl)) {
    return false;
  }

  return PipelineImpl.derivesFrom(pipeline, layer);
}

/**
 * Пайплайн объявил ambient-переменную.
 *
 * Объявителем считается **только** pre-юнит формы `<Var>.provide(…)`: юнит,
 * кладущий то же поле обычной функцией, работает как прежде (читатели видят
 * поле через проекцию), но декларацией не считается — иначе она жила бы
 * отдельно от факта. Идентичность переменной ссылочная: одноимённая
 * переменная из соседнего вызова `contextVar` — другое значение.
 *
 * @internal основание предиката `hasVar` словаря политик; наружу поведение
 * видно через `everyEndpoint(...).hasVar(...)`
 */
export function declaresVar(pipeline: unknown, variable: unknown): boolean {
  if (!(pipeline instanceof PipelineImpl) || !isContextVar(variable)) {
    return false;
  }

  return PipelineImpl.declaresVar(pipeline, variable);
}
