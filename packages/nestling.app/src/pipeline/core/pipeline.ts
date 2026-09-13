import { defaultLogger } from '../../logger/console.js';
import type { Logger } from '../../logger/interface.js';
import type { Metrics } from '../../metrics/interface.js';
import { KERNEL_METRICS } from '../../metrics/names.js';

import type { RequestCell } from './context/store.js';
import {
  iterateInScope,
  makeCell,
  runInScope,
  setPhase,
} from './context/store.js';
import type { AnyContextVar } from './context/variable.js';
import { declaredVarOf, isContextVar } from './context/variable.js';
import { bindOutputStream, isAsyncIterable, withFinish } from './io/index.js';
import { validateInput } from './io/validate-input.js';
import type {
  EndpointMeta,
  ErrorDetails,
  ErrorResponseContext,
  ExtendableContext,
  ResponseContext,
  SuccessResponseContext,
} from './types/context.js';
import type {
  AnyAddition,
  CatchStepFn,
  FinallyStepFn,
  OkStepFn,
  Outcome,
  PreStepFn,
  ResponseTrackInput,
  StepInstance,
  StepLike,
} from './types/step.js';
import { computeOutcome } from './abort.js';
import type { DeferredStep, STEP_NEEDS } from './deferred.js';
import { deferredOf } from './deferred.js';
import type { Done } from './done.js';
import { isDone } from './done.js';

import type { Constructor } from '@nestlingjs/common.misc';
import type { InjectionToken } from '@nestlingjs/container';
import { tokenId } from '@nestlingjs/container';
import type {
  AnyFail,
  AnyFailDefinition,
  AnyInput,
  EmptyInput,
  FailOf,
  FailsOf,
  KernelFail,
  Output,
  OutputSync,
} from '@nestlingjs/operations';
import {
  categoryOf,
  describeForm,
  InternalError,
  isCategory,
  isFail,
  isFailDefinition,
  isKernelFailCode,
  isStreamKind,
  isTransportResponse,
  Ok,
} from '@nestlingjs/operations';

/**
 * Ошибка, которая произошла после начала отдачи потокового ответа.
 *
 * Заголовки к этому моменту уже отправлены, и статус изменить нельзя.
 * Поэтому наружу уходит не исходная ошибка, а готовый контекст ответа
 * `response`: транспорт собирает из него кадр ошибки (`event: error` для
 * SSE) или обрывает соединение (NDJSON). Исходная ошибка уже записана в
 * логгер.
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
 * Pre-шаг вернул `done()` из пайплайна без признака досрочного успеха.
 *
 * Это ошибка композиции, а не отказ домена: клиент получает
 * `internal_error`, а текст называет починку.
 */
export class UndeclaredDoneError extends Error {
  constructor(stepName: string) {
    super(
      `Pre-step '${stepName}' returned done(), but the pipeline does not ` +
        `declare an early success. Connect the step as ` +
        `.pre(${stepName}, { done: true }): the declaration with such a ` +
        `pipeline is checked for having no 'output'.`,
    );
    this.name = 'UndeclaredDoneError';
  }
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
   * Логгер для отказов, не объявленных в `errors:`. Без него запись уходит
   * в логгер ядра по умолчанию, чтобы такой отказ не терялся молча.
   */
  logger?: Logger;

  /**
   * Метрики обработки запроса. Поле заполняется только тогда, когда
   * приложение задало реализацию опцией `makeApp({ metrics })`: без неё
   * рантайм не снимает время и не вызывает ни одного метода записи.
   */
  metrics?: Metrics;
}

/**
 * Пишет счётчик и длительность обработки запроса.
 *
 * Атрибуты берутся из декларации endpoint'а, а не из запроса: `pattern` —
 * шаблон маршрута, поэтому количество рядов у экспортёра конечно.
 */
function recordRequest(
  metrics: Metrics,
  endpoint: EndpointMeta,
  outcome: Outcome,
  durationMs: number,
): void {
  const attributes = {
    transport: endpoint.transport,
    pattern: endpoint.pattern,
    outcome,
  };

  metrics.counter(KERNEL_METRICS.requests, 1, attributes);
  metrics.histogram(KERNEL_METRICS.requestDuration, durationMs, attributes);
}

/**
 * Пишет незадекларированный отказ в логгер: сообщение постоянное, чтобы
 * по нему искать; транспорт, паттерн, код отказа и оригинал — поля.
 */
function reportUnknownFail(
  logger: Logger,
  error: unknown,
  endpoint: EndpointMeta,
): void {
  const code = isFail(error) ? error.code : undefined;

  logger.error(`undeclared fail normalized to ${InternalError.code}`, {
    transport: endpoint.transport,
    pattern: endpoint.pattern,
    ...(code === undefined ? {} : { code }),
    err: error,
  });
}

type OverlapKeys<A, B> = keyof A & keyof B;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

// ---------------------------------------------------------------------------
// Типы-ошибки
//
// Каждый тип-ошибка обёрнут в `Simplify<…>` внутри алиаса. Без обёртки
// TypeScript печатает именованный дженерик-алиас его именем
// (`ComposeError<…>`), и текст `__error` в диагностике пропадает. Обёртка —
// часть операции диагностики; её проверяют снапшоты в `type-tests/`.
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

/** Тип-ошибка `.pre`: накопленный `input` не покрывает требования шага */
type PreRequirementError<TCurrentInput, TReq> = Simplify<{
  __error: 'Pre-step requires context that the accumulated input does not provide';
  missing: MissingFields<TCurrentInput, TReq>;
}>;

/** Тип-ошибка `.pre`: шаг перезаписывает уже накопленное поле */
type PreConflictError<TCurrentInput, TAdd> = Simplify<{
  __error: 'Pre-step overrides fields that are already in the input';
  conflicting: ConflictingFields<TCurrentInput, TAdd>;
}>;

/** Тип-ошибка `.pre`: шаг возвращает отказ вне списка `errors` этого `.pre` */
type PreUndeclaredFailError<TUndeclared> = Simplify<{
  __error: 'Pre-step returns a fail that is not declared in errors of this .pre';
  undeclared: TUndeclared;
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
 * Проверяет, что требования `TReq`, добавка и отказы шага совместимы с
 * накопленным `input` и со списком `errors` этого `.pre`.
 *
 * Возвращает `M`, если да, и тип-ошибку, если нет. Порядок проверок —
 * от внешнего к внутреннему: сначала требования к контексту, затем
 * перезапись полей, затем незадекларированный отказ.
 */
type CheckPreStep<TCurrentInput, TReq, TAdd, TReturned, M> = [
  TCurrentInput,
] extends [TReq]
  ? [ConflictingKeys<TCurrentInput, TAdd>] extends [never]
    ? [TReturned] extends [never]
      ? M
      : PreUndeclaredFailError<TReturned>
    : PreConflictError<TCurrentInput, TAdd>
  : PreRequirementError<TCurrentInput, TReq>;

/**
 * Функция шага, извлечённая из его формы: у класса и у инстанса это
 * `handle`, у функции — она сама.
 */
type StepFnOf<M> =
  M extends Constructor<StepInstance<infer F>>
    ? F
    : M extends StepInstance<infer F>
      ? F
      : M;

/** Результат `.pre`-шага любой формы, развёрнутый из `Promise` */
type PreStepResult<M> =
  StepFnOf<M> extends (...args: any[]) => infer R ? Awaited<R> : never;

/**
 * Отказы, которые шаг возвращает значением.
 *
 * У шага с результатом `any` отказов нет: `any` поглотил бы проверку и
 * сделал бы такой шаг ошибкой в любом `.pre`.
 */
type ReturnedFails<TResult> = 0 extends 1 & TResult
  ? never
  : Extract<TResult, AnyFail>;

/** Добавка шага: результат без отказа, без досрочного успеха и без «ничего» */
type AdditionOf<TResult> = NormalizeAddition<
  /* eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- `void` в результате шага — поддерживаемая форма: шаг-наблюдатель пишется как обычная функция без `return` (см. `PreStepFn`) */
  Exclude<TResult, AnyFail | Done | undefined | void>
>;

/** Отказы, которые `.pre` разрешает вернуть: объявленные плюс отказы ядра */
type AllowedFails<F extends readonly AnyFailDefinition[]> =
  | FailsOf<F>
  | FailOf<KernelFail>;

/**
 * Проверяет `.pre`-шаг любой из трёх форм (функция, инстанс, класс):
 * требования к накопленному `input`, добавку и возвращаемые отказы.
 */
type ValidatePreStep<
  TCurrentInput extends AnyInput,
  F extends readonly AnyFailDefinition[],
  M,
> =
  StepFnOf<M> extends PreStepFn<infer TReq, any, any>
    ? CheckPreStep<
        TCurrentInput,
        TReq,
        AdditionOf<PreStepResult<M>>,
        Exclude<ReturnedFails<PreStepResult<M>>, AllowedFails<F>>,
        M
      >
    : never;

/**
 * Приводит добавку шага к объекту: `undefined` и `never` становятся `{}`,
 * чтобы шаг без добавки не менял тип пайплайна.
 */
type NormalizeAddition<TAdd> = [TAdd] extends [never]
  ? // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {}
  : TAdd extends AnyAddition
    ? TAdd
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

/** Добавка `.pre`-шага любой формы, приведённая к объекту */
type ExtractAddition<M> = AdditionOf<PreStepResult<M>>;

/**
 * Отложенные зависимости шага: для класс-формы это её конструктор, для
 * писателя переменной с зависимостями — его DI-токены, для остальных форм
 * — `never`.
 */
type ExtractNeeds<M> =
  M extends Constructor<StepInstance<any>>
    ? M
    : M extends { readonly [STEP_NEEDS]: readonly (infer N)[] }
      ? N
      : never;

/**
 * Тип-параметры пайплайна в виде объекта. Существует только в типах:
 * по нему `compose` и вспомогательные типы выводят параметры.
 */
export interface PipelineTypes<
  TReq extends AnyInput,
  TAcc extends AnyInput,
  TNeeds,
  TFails extends AnyFail,
> {
  req: TReq;
  acc: TAcc;
  needs: TNeeds;
  fails: TFails;
}

/**
 * Даёт `bind()` значение по DI-токену; обычно это контейнер.
 *
 * Резолвер один на оба вида отложенных зависимостей: класс-шаг — DI-токен,
 * которым служит сам класс, писатель переменной — список DI-токенов из
 * `Var.provide(deps, compute)`.
 */
export type StepResolver = (token: InjectionToken) => unknown;

/**
 * Пайплайн: иммутабельное значение, которое умеет выполнить запрос.
 *
 * @template TReq - Требования слоя к внешнему контексту. Задаются
 * `makePipeline<TReq>()` и проверяются компилятором в `compose`
 * @template TAcc - `input`, накопленный `.pre`-шагами (включает `TReq`)
 * @template TNeeds - Отложенные зависимости: классы-шаги без инстанса и
 * DI-токены писателей переменных. `never` — пайплайн готов к выполнению;
 * иначе нужен `bind()` (`App` вызывает его на фазе WIRE)
 * @template TFails - Отказы, объявленные при подключении `.pre`-шагов.
 * Декларация складывает их со своим `errors:` в эффективное множество
 */
export interface Pipeline<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
  TFails extends AnyFail = never,
> {
  /** @internal Существует только в типах; по нему выводятся параметры */
  readonly $types?: PipelineTypes<TReq, TAcc, TNeeds, TFails>;

  /**
   * Резолвит отложенные зависимости через `resolve` (обычно это контейнер)
   * — создаёт инстансы классов-шагов и подставляет значения писателям
   * переменных — и возвращает пайплайн, готовый к выполнению
   * (`TNeeds = never`).
   */
  bind(resolve: StepResolver): Pipeline<TReq, TAcc, never, TFails>;

  /**
   * Выполняет запрос: `.pre`-шаги, проверку входа по схеме `input`,
   * хендлер, `.ok`/`.catch`, проверку `errors:` и `.finally`.
   *
   * Доступен только при `TNeeds = never`: у всех классов-шагов есть
   * инстансы.
   *
   * @param handler - Хендлер endpoint'а; получает `payload` и `meta`
   * отдельными аргументами. `payload` типизирован `unknown`: его тип
   * задаёт схема `input` декларации, которой пайплайн не знает, — один и
   * тот же пайплайн служит нескольким endpoint'ам
   * @param ctx - Начальный контекст, собранный транспортом
   * @param options - Опции выполнения
   */
  executeWithHandler<TOutput>(
    this: Pipeline<TReq, TAcc, never, TFails>,
    handler: (
      payload: unknown,
      meta: (TAcc extends { payload: unknown }
        ? Omit<TAcc, 'payload'>
        : TAcc) & { signal: AbortSignal },
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
  TFails extends AnyFail = never,
> extends Pipeline<TReq, TAcc, TNeeds, TFails> {
  /** Добавляет шаг для успешного ответа; шаг видит полный `ctx` */
  ok<M extends StepLike<OkStepFn<TAcc>>>(
    step: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>, TFails>;

  /** Добавляет шаг для ответа-ошибки; поля своего слоя в `ctx` — `Partial` */
  catch<M extends StepLike<CatchStepFn<ResponseTrackInput<TReq, TAcc>>>>(
    step: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>, TFails>;

  /** Добавляет наблюдатель исхода; вызывается всегда и последним */
  finally<M extends StepLike<FinallyStepFn<ResponseTrackInput<TReq, TAcc>>>>(
    step: M,
  ): PhasedPipeline<TReq, TAcc, TNeeds | ExtractNeeds<M>, TFails>;
}

/**
 * Второй аргумент `.pre`: объявление отказов и досрочного успеха
 * подключаемого шага.
 */
export interface PreOptions<
  F extends readonly AnyFailDefinition[] = readonly AnyFailDefinition[],
> {
  /**
   * Отказы, которыми может завершиться шаг: список определений `makeFail`.
   *
   * Шаг может вернуть отказ только из этого списка или отказ ядра;
   * остальное — ошибка компиляции в точке `.pre`. Декларация со слоем
   * получает эти отказы в своё эффективное множество и не перечисляет их
   * в `errors:`.
   */
  errors?: F;

  /**
   * Право шага завершить endpoint досрочным успехом — вернуть `done()`.
   *
   * Признак ставится на пайплайн-значение. Декларация с таким пайплайном
   * обязана быть без `output`: значения досрочный успех не несёт.
   * Возврат `done()` из шага без признака роняет запрос ошибкой.
   */
  done?: boolean;
}

/** Пайплайн, к которому ещё можно добавлять `.pre`-шаги */
export interface PipelineBuilder<
  TReq extends AnyInput = EmptyInput,
  TAcc extends AnyInput = TReq,
  TNeeds = never,
  TFails extends AnyFail = never,
> extends PhasedPipeline<TReq, TAcc, TNeeds, TFails> {
  /**
   * Добавляет шаг до хендлера; его добавка расширяет `input`, а
   * объявленные вторым аргументом отказы — множество отказов пайплайна.
   */
  pre<
    M extends StepLike<PreStepFn<any, any, any>>,
    F extends readonly AnyFailDefinition[] = [],
  >(
    step: ValidatePreStep<TAcc, F, M>,
    options?: PreOptions<F>,
  ): PipelineBuilder<
    TReq,
    TAcc & ExtractAddition<M>,
    TNeeds | ExtractNeeds<M>,
    TFails | FailsOf<F>
  >;
}

/**
 * Пайплайн с любыми тип-параметрами.
 *
 * В сигнатурах перегрузок `compose` не используется: один тип-параметр на
 * слой заставлял компилятор разворачивать всю цепочку на каждом уровне
 * вложенности (`type-tests/BUDGET.md`).
 */
export type AnyPipeline = Pipeline<any, any, any, any>;

/**
 * Проверяет в `compose`, что внешние слои дают всё, что требует внутренний
 * (`makePipeline<TReq>()`).
 *
 * При успехе — `Pipeline<R, A, N>`, из которого TypeScript выводит
 * тип-параметры внутреннего слоя. При ошибке — только литерал ошибки, без
 * пересечения с типом слоя: иначе первая строка диагностики продолжалась
 * бы хвостом `& PipelineBuilder<...>`.
 */
type Guard<
  Provided,
  R extends AnyInput,
  A extends AnyInput,
  N,
  F extends AnyFail,
> = [Provided] extends [R] ? Pipeline<R, A, N, F> : ComposeError<Provided, R>;

// ---------------------------------------------------------------------------
// Рантайм
// ---------------------------------------------------------------------------

type AnyStepFn = (...args: unknown[]) => unknown;

interface StepEntry {
  /** Готовая к вызову функция шага (или `handle` инстанса с `bind`) */
  fn?: AnyStepFn;
  /** Класс шага, пока `bind()` не создал инстанс */
  ctor?: Constructor<StepInstance<AnyStepFn>>;
  /** Отложенный шаг, пока `bind()` не подставил значения зависимостей */
  deferred?: DeferredStep;
  /**
   * Имя шага в той форме, в какой его подключили.
   *
   * Считается один раз при подключении и переживает `bind()`: у инстанса
   * `handle.bind(instance)` называется `bound handle`, и текст ошибки по
   * такому имени адресата не находит.
   */
  name: string;
}

/** Имя шага, которому ещё нужен `bind()`; `undefined` — шаг готов */
const pendingStepName = (entry: StepEntry): string | undefined =>
  entry.fn ? undefined : (entry.ctor?.name ?? entry.deferred?.name);

type ResponsePhase = 'ok' | 'catch';

interface ResponseEntry extends StepEntry {
  phase: ResponsePhase;
}

interface Layer {
  pre: StepEntry[];
  responses: ResponseEntry[];
  finals: StepEntry[];
}

function normalizeStep(step: unknown): StepEntry {
  const name = describeStep(step);

  if (typeof step === 'function') {
    // Писатель с зависимостями — заглушка до `bind()`: исполнять её нельзя
    const deferred = deferredOf(step);
    if (deferred) {
      return { deferred, name: deferred.name };
    }

    // У класса-шага есть handle в прототипе; обычная функция — сама шаг
    const proto = (step as { prototype?: { handle?: unknown } }).prototype;
    if (proto && typeof proto.handle === 'function') {
      return { ctor: step as Constructor<StepInstance<AnyStepFn>>, name };
    }
    return { fn: step as AnyStepFn, name };
  }

  if (
    step !== null &&
    typeof step === 'object' &&
    typeof (step as StepInstance<AnyStepFn>).handle === 'function'
  ) {
    const instance = step as StepInstance<AnyStepFn>;
    return { fn: instance.handle.bind(instance), name };
  }

  throw new TypeError(
    'Pipeline step must be a function, an instance with handle(), or a class with handle()',
  );
}

/** Имя шага для текстов ошибок: у инстанса — имя его класса */
function describeStep(step: unknown): string {
  if (typeof step === 'function') {
    return step.name || '<anonymous>';
  }

  const ctor = (step as { constructor?: { name?: string } } | undefined)
    ?.constructor;

  return ctor?.name ?? String(step);
}

/**
 * Проверяет список `errors` второго аргумента `.pre`: каждый элемент
 * создан `makeFail`, коды не повторяются. Текст ошибки называет шаг.
 *
 * Правило то же, что у `errors:` декларации; отличается только адресат в
 * тексте.
 */
function readPreFails(
  options: { errors?: unknown } | undefined,
  step: unknown,
): readonly AnyFailDefinition[] {
  const errors = options?.errors;
  if (errors === undefined) {
    return [];
  }

  const where = `pre(${describeStep(step)}, { errors })`;

  if (!Array.isArray(errors)) {
    throw new TypeError(
      `${where}: 'errors' must be an array of makeFail() definitions.`,
    );
  }

  const seen = new Set<string>();
  for (const [index, definition] of errors.entries()) {
    if (!isFailDefinition(definition)) {
      throw new TypeError(
        `${where}: errors[${index}] is not a fail definition — ` +
          `expected a value created by makeFail().`,
      );
    }

    if (seen.has(definition.code)) {
      throw new Error(`${where}: duplicate error code '${definition.code}'.`);
    }
    seen.add(definition.code);
  }

  return errors as readonly AnyFailDefinition[];
}

/**
 * Читает признак досрочного успеха второго аргумента `.pre`.
 *
 * Правило то же, что у `errors`: значение проверяется там, где объявлено,
 * и текст ошибки называет шаг.
 */
function readPreDone(
  options: { done?: unknown } | undefined,
  step: unknown,
): boolean {
  const done = options?.done;

  if (done === undefined) {
    return false;
  }

  if (typeof done !== 'boolean') {
    throw new TypeError(
      `pre(${describeStep(step)}, { done }): 'done' must be a boolean — ` +
        `it declares that the step may finish the endpoint with an early ` +
        `success.`,
    );
  }

  return done;
}

/**
 * Складывает множества определений отказов, считая совпадением равенство
 * `code`: два определения с одним кодом — один отказ.
 */
function mergeFails(
  sets: Iterable<Iterable<AnyFailDefinition>>,
): ReadonlySet<AnyFailDefinition> {
  const merged = new Set<AnyFailDefinition>();
  const codes = new Set<string>();

  for (const set of sets) {
    for (const definition of set) {
      if (!codes.has(definition.code)) {
        codes.add(definition.code);
        merged.add(definition);
      }
    }
  }

  return merged;
}

function cloneLayer(layer: Layer): Layer {
  return {
    pre: [...layer.pre],
    responses: [...layer.responses],
    finals: [...layer.finals],
  };
}

/**
 * Возвращает функцию шага. Ошибка недостижима после проверки классов без
 * инстансов в `execute`; она страхует от рассинхрона двух проверок.
 */
function materialized(entry: StepEntry): AnyStepFn {
  if (!entry.fn) {
    throw new Error('Pipeline step is not materialized; call bind() first');
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
    /** `true` для результата `compose`: шаги добавлять нельзя */
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
     * Контекстные переменные, объявленные `.pre`-шагами этого пайплайна.
     *
     * Правила те же, что у `sources`: `compose` объединяет множества,
     * методы билдера и `bind()` их сохраняют. В выполнении не участвует:
     * его читает только {@link PipelineImpl.declaresVar} (политика
     * `hasVar`).
     */
    private readonly declared: ReadonlySet<AnyContextVar> = new Set(),
    /**
     * Отказы, объявленные при подключении `.pre`-шагов этого пайплайна.
     *
     * Правила те же, что у `declared`: `compose` объединяет множества,
     * методы билдера и `bind()` их сохраняют. Множество читает
     * `makeEndpoint`: оно складывает его с `errors:` декларации в
     * эффективное множество отказов endpoint'а.
     */
    private readonly declaredFails: ReadonlySet<AnyFailDefinition> = new Set(),
    /**
     * Подключён ли хоть один `.pre`-шаг с правом досрочного успеха
     * (`.pre(step, { done: true })`).
     *
     * Правила те же, что у `declaredFails`: `compose` берёт дизъюнкцию,
     * методы билдера и `bind()` признак сохраняют. Читают его
     * {@link PipelineImpl.declaresDone} и само исполнение: возврат
     * `done()` из пайплайна без признака — ошибка.
     */
    private readonly declaredDone = false,
  ) {
    // Слои после конструктора не меняются: методы билдера и `bind()`
    // возвращают новый экземпляр. Поэтому инварианты, которые раньше
    // проверялись на каждый запрос, считаются здесь один раз
    this.unresolvedStep = layers
      .flatMap((layer) => [...layer.pre, ...layer.responses, ...layer.finals])
      .map(pendingStepName)
      .find((name) => name !== undefined);
    this.hasFinals = layers.some((layer) => layer.finals.length > 0);
  }

  /** Имя первого шага, которому нужен `bind()`; `execute` отказывает по нему */
  private readonly unresolvedStep: string | undefined;

  /** Есть ли хоть один `.finally`-шаг; без них ответная фаза их не ждёт */
  private readonly hasFinals: boolean;

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
      // Отказы объединяются по тому же правилу; совпадение — по `code`
      mergeFails(pipelines.map((p) => p.declaredFails)),
      // Признак досрочного успеха — дизъюнкция признаков аргументов
      pipelines.some((p) => p.declaredDone),
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

  /** Отказы, объявленные слоями пайплайна; обход источников не нужен */
  static declaredFailsOf(pipeline: PipelineImpl): readonly AnyFailDefinition[] {
    return [...pipeline.declaredFails];
  }

  /** Несёт ли пайплайн признак досрочного успеха */
  static declaresDone(pipeline: PipelineImpl): boolean {
    return pipeline.declaredDone;
  }

  private withOwnLayer(
    mutate: (layer: Layer) => void,
    sealed: boolean,
    declares?: AnyContextVar,
    fails: readonly AnyFailDefinition[] = [],
    declaresDone = false,
  ): PipelineImpl {
    if (this.composed) {
      throw new Error(
        'Cannot add steps to a composed pipeline; add them to a layer before compose()',
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
    const declaredFails =
      fails.length > 0
        ? mergeFails([this.declaredFails, fails])
        : this.declaredFails;

    // Новый пайплайн помнит предшественника: `authed.pre(x)` для политики
    // `hasLayer(authed)` по-прежнему содержит `authed`
    return new PipelineImpl(
      [layer],
      sealed,
      false,
      [this],
      declared,
      declaredFails,
      this.declaredDone || declaresDone,
    );
  }

  pre(
    step: unknown,
    options?: { errors?: unknown; done?: unknown },
  ): PipelineImpl {
    if (this.sealed) {
      throw new Error(
        'pre() is not available after a response-phase method (.ok/.catch/.finally)',
      );
    }
    // Список проверяется здесь же, где объявлен: ошибка называет шаг
    const fails = readPreFails(options, step);
    const done = readPreDone(options, step);

    // Объявителем переменной считается только шаг из `<Var>.provide(…)`
    return this.withOwnLayer(
      (l) => l.pre.push(normalizeStep(step)),
      false,
      declaredVarOf(step),
      fails,
      done,
    );
  }

  ok(step: unknown): PipelineImpl {
    return this.withOwnLayer(
      (l) => l.responses.push({ ...normalizeStep(step), phase: 'ok' }),
      true,
    );
  }

  catch(step: unknown): PipelineImpl {
    return this.withOwnLayer(
      (l) => l.responses.push({ ...normalizeStep(step), phase: 'catch' }),
      true,
    );
  }

  finally(step: unknown): PipelineImpl {
    return this.withOwnLayer((l) => l.finals.push(normalizeStep(step)), true);
  }

  bind(resolve: StepResolver): PipelineImpl {
    const resolveEntry = <E extends StepEntry>(entry: E): E => {
      if (entry.deferred) {
        const { name, deps, make } = entry.deferred;
        // Значения берутся один раз: писатель — синглтон, как класс-шаг
        const values = deps.map((token) => {
          const value = resolve(token);
          if (value === undefined) {
            throw new Error(
              `Cannot bind pipeline step ${name}: resolver returned no value ` +
                `for '${tokenId(token)}'`,
            );
          }
          return value;
        });

        return { ...entry, deferred: undefined, fn: make(values) as AnyStepFn };
      }
      if (!entry.ctor) {
        return entry;
      }
      const instance = resolve(entry.ctor as Constructor<unknown>);
      if (
        instance === null ||
        typeof instance !== 'object' ||
        typeof (instance as StepInstance<AnyStepFn>).handle !== 'function'
      ) {
        throw new Error(
          `Cannot bind pipeline step ${entry.ctor.name}: resolver returned no instance with handle()`,
        );
      }
      const step = instance as StepInstance<AnyStepFn>;
      return { ...entry, ctor: undefined, fn: step.handle.bind(step) };
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
      this.declaredFails,
      this.declaredDone,
    );
  }

  /**
   * Открывает область асинхронного контекста на всё выполнение запроса:
   * `.pre`-шаги, проверку входа, хендлер, `.ok`/`.catch`, проверку
   * `errors:` и `.finally`.
   *
   * Область открывается всегда, даже если в приложении нет ни одного
   * читателя `Ctx`: цена — одна ячейка и `als.run` на запрос, зато рантайм
   * пайплайна не зависит от сборки графа.
   *
   * Метод не `async`: он возвращает промис `execute` как есть, без
   * собственной обёртки и лишнего тика микротасков.
   */
  executeWithHandler(
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
    if (this.unresolvedStep !== undefined) {
      throw new Error(
        `Pipeline has unresolved steps (${this.unresolvedStep}); ` +
          'call bind() or run under App',
      );
    }

    const exposeErrorDetails = options.exposeErrorDetails ?? false;
    const logger = options.logger ?? defaultLogger;
    const { metrics } = options;

    // Часы заводятся только под настроенные метрики: приложение без них
    // не платит за наблюдаемость ни одним вызовом
    const startedAt = metrics ? performance.now() : 0;

    let response: ResponseContext<unknown>;

    // Слои активируются строго по порядку, поэтому активированные — это
    // префикс `layers`, и ответной фазе хватает его длины
    let activatedCount = 0;

    /** Один из pre-шагов вернул `done()`: хендлера не будет */
    let earlySuccess = false;

    /**
     * Исходная ошибка текущего ответа-ошибки: `enforceDeclaredFails` передаёт
     * её хуку целиком. В самом ответе остаётся только то, что можно
     * показать клиенту.
     */
    let originalError: unknown;

    /**
     * Ответ порождён необработанной ошибкой (не `Fail`). Такой ответ уже
     * несёт код `internal_error`, но объявленным не считается: хук обязан
     * его увидеть.
     */
    let unhandled = false;

    try {
      // `.pre`-шаги слоёв, снаружи внутрь. Слой активирован с первого
      // своего `.pre`-шага: его `.ok`/`.catch`/`.finally` выполнятся.
      layers: for (const layer of this.layers) {
        activatedCount += 1;
        for (const entry of layer.pre) {
          const result = await materialized(entry)(ctx);

          // Досрочный успех проверяется первым и до записи в контекст:
          // значение не добавка и не отказ, в `ctx.input` ему места нет
          if (isDone(result)) {
            if (!this.declaredDone) {
              throw new UndeclaredDoneError(entry.name);
            }

            earlySuccess = true;
            break layers;
          }

          // Отказ, возвращённый шагом, идёт тем же путём, что брошенный:
          // в контекст он не пишется, следующие шаги и хендлер не
          // вызываются, ответную фазу открывает тот же `catch`
          if (isFail(result)) {
            throw result;
          }

          // Результат дописывается в тот же объект `input`: ячейка контекста
          // ссылается на него с создания, и сервис, вызванный следующим
          // шагом, читает через `Ctx` уже дополненный контекст
          if (result !== undefined && result !== null) {
            Object.assign(ctx.input, result as AnyAddition);
          }
        }
      }

      if (earlySuccess) {
        // Проверка входа и хендлер пропускаются: их результат некому
        // читать. Ответ — успех без значения, как у декларации без
        // `output`
        response = { isSuccess: true, status: 'ok', value: undefined };
      } else {
        const finalInput = ctx.input;
        const { payload, ...meta } = finalInput as AnyAddition & {
          payload?: unknown;
        };

        // Кандидат проверки: `.pre`-шаг мог подменить значение для
        // хендлера, положив в контекст ключ `payload`
        const candidate = 'payload' in finalInput ? payload : ctx.raw.payload;

        // Проверка входа стоит после всех `.pre`-шагов и до хендлера: к
        // этому моменту активированы все слои, поэтому отказ 400 видят их
        // `.catch` и `.finally`
        const effectivePayload = validateInput(
          describeForm(ctx.endpoint.input),
          candidate,
        );

        setPhase(cell, 'handler');

        // Ключ `signal` зарезервирован: значение пайплайна перекрывает
        // одноимённое поле из `.pre`-шагов
        const result = await handler(effectivePayload, {
          ...meta,
          signal: ctx.signal,
        });

        // Возвращённый `Fail` обрабатывается как брошенный: `.ok`-шаги не
        // выполняются ни в одном из двух случаев
        if (isFail(result)) {
          originalError = result;
          response = this.errorToResponse(result, exposeErrorDetails);
        } else {
          response = this.normalizeResponse(result, ctx);
        }
      }
    } catch (error) {
      originalError = error;
      unhandled = !isFail(error);
      response = this.errorToResponse(error, exposeErrorDetails);
    }

    setPhase(cell, 'response');

    // `.ok`/`.catch`: активированные слои изнутри наружу, шаги слоя в
    // порядке объявления. Шаг выполняется, если подходит текущему ответу.
    for (let index = activatedCount - 1; index >= 0; index--) {
      const layer = this.layers[index];
      for (const entry of layer.responses) {
        const applicable = (entry.phase === 'ok') === response.isSuccess;
        if (!applicable) {
          continue;
        }

        try {
          const replaced = (await materialized(entry)(response, ctx)) as
            | ResponseContext<unknown>
            | AnyFail
            | undefined;
          if (replaced !== undefined && replaced !== null) {
            // `.catch` может вернуть просто `Fail`; он нормализуется так
            // же, как отказ хендлера
            if (isFail(replaced)) {
              originalError = replaced;
              unhandled = false;
              response = this.errorToResponse(replaced, exposeErrorDetails);
            } else {
              originalError = replaced.isSuccess ? undefined : replaced;
              unhandled = false;
              response = replaced;
            }
          }
        } catch (error) {
          // Исключение из `.ok`/`.catch` — необработанная ошибка: ответ
          // заменяется, остальные шаги продолжают
          originalError = error;
          unhandled = !isFail(error);
          response = this.errorToResponse(error, exposeErrorDetails);
        }
      }
    }

    // Проверка `errors:` стоит после `.catch` (там незадекларированный
    // отказ ещё можно превратить в задекларированный) и до `.finally`
    // (наблюдатель видит тот ответ, который уйдёт клиенту)
    response = this.enforceDeclaredFails(
      response,
      originalError,
      unhandled,
      ctx.endpoint,
      exposeErrorDetails,
      logger,
    );

    // `.finally`: изнутри наружу, всегда. Исключения наблюдателей на ответ
    // не влияют; шаг обрабатывает свои ошибки сам
    const runFinals = async (
      outcome: Outcome,
      settled: ResponseContext<unknown>,
    ): Promise<void> => {
      for (let index = activatedCount - 1; index >= 0; index--) {
        const layer = this.layers[index];
        for (const entry of layer.finals) {
          try {
            await materialized(entry)(outcome, settled, ctx);
          } catch {
            // намеренно: `.finally` — наблюдатель, его ошибки ответ не меняют
          }
        }
      }
    };

    /**
     * Завершение запроса: метрика и наблюдатели, в этом порядке.
     *
     * Метрика — до `.finally`-шагов: их ошибки проглатываются, и запись
     * не должна зависеть от того, чем занят наблюдатель. Исход у обеих
     * сторон один и тот же.
     */
    const settle = async (
      outcome: Outcome,
      settled: ResponseContext<unknown>,
    ): Promise<void> => {
      if (metrics) {
        recordRequest(
          metrics,
          ctx.endpoint,
          outcome,
          performance.now() - startedAt,
        );
      }

      if (this.hasFinals) {
        await runFinals(outcome, settled);
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
            await settle(computeOutcome(ctx.signal, delivered), delivered);
            return;
          }

          // Та же проверка `errors:` и тот же логгер, что на обычном пути
          const failure = this.enforceDeclaredFails(
            this.errorToResponse(error, exposeErrorDetails),
            error,
            !isFail(error),
            ctx.endpoint,
            exposeErrorDetails,
            logger,
          ) as ErrorResponseContext;

          await settle(computeOutcome(ctx.signal, delivered, true), failure);

          return new MidStreamFailure(failure, { cause: error });
        },
      );

      // Область контекста — самая внешняя обёртка: в ней выполняются и
      // шаги потока, и `.finally`-шаги после его завершения
      return {
        ...delivered,
        value: iterateInScope(cell, stream),
      } as ResponseContext<unknown>;
    }

    setPhase(cell, 'finally');

    if (this.hasFinals || metrics) {
      await settle(computeOutcome(ctx.signal, response), response);
    }

    return response;
  }

  /**
   * Превращает результат хендлера в `ResponseContext`.
   *
   * Конверт транспортного ответа разбирается здесь же: значение внутри
   * него проходит тот же код, что и ответ без конверта, а имя транспорта
   * и метаданные протокола уходят в поле `transport` контекста.
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
    // Конверт транспортного ответа. Символ проверяется после `Ok`:
    // обычный ответ — самая частая ветка, и до чтения символа она не
    // доходит.
    const envelope =
      result instanceof Ok || !isTransportResponse(result) ? undefined : result;

    const payload = (envelope ? envelope.result : result) as T;

    const base: SuccessResponseContext<T> =
      payload instanceof Ok
        ? {
            isSuccess: true,
            status: payload.status,
            value: payload.value as T,
          }
        : {
            isSuccess: true,
            status: 'ok',
            value: payload,
          };

    if (envelope) {
      base.transport = { name: envelope.transport, meta: envelope.meta };
    }

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
   * независимо от `exposeErrorDetails`. Категория восстанавливается из
   * кода: у значения без прототипа аксессора нет. Незадекларированный
   * отказ позже заменит `enforceDeclaredFails`.
   *
   * Любая другая ошибка считается внутренней: ответ несёт код
   * `internal_error`, а клиенту по умолчанию уходит только общее
   * сообщение, без `message` и `stack`.
   */
  private errorToResponse(
    error: unknown,
    exposeErrorDetails: boolean,
  ): ErrorResponseContext {
    if (isFail(error)) {
      const code =
        typeof error.code === 'string' ? error.code : InternalError.code;
      const category = categoryOf(code);
      const errorValue: ErrorDetails = {
        error: typeof error.message === 'string' ? error.message : 'Error',
        code,
      };

      if (error.details !== undefined) {
        errorValue.details = error.details;
      }

      return {
        isSuccess: false,
        status: isCategory(category) ? category : InternalError.category,
        value: errorValue,
      };
    }

    return {
      isSuccess: false,
      status: InternalError.category,
      value: {
        ...unhandledBody(error, exposeErrorDetails),
        code: InternalError.code,
      },
    };
  }

  /**
   * Проверяет ответ-ошибку по `errors:` endpoint'а.
   *
   * Ответ проходит, если его код объявлен в `errors:` или является кодом
   * ядра. Любой другой ответ — незадекларированный отказ, анонимный
   * `Fail.*` вне `errors:`, необработанная ошибка — заменяется на
   * `InternalError`; исходная ошибка записывается в логгер.
   */
  private enforceDeclaredFails(
    response: ResponseContext<unknown>,
    originalError: unknown,
    unhandled: boolean,
    endpoint: EndpointMeta,
    exposeErrorDetails: boolean,
    logger: Logger,
  ): ResponseContext<unknown> {
    if (response.isSuccess) {
      return response;
    }

    const code = response.value.code;
    const declared = (endpoint.errors ?? []).some(
      (definition) => definition.code === code,
    );

    if (!unhandled && (declared || isKernelFailCode(code))) {
      return response;
    }

    // Исходной ошибки может не быть (ответ собрал `.catch`-шаг вручную);
    // тогда в запись попадает сам ответ
    reportUnknownFail(logger, originalError ?? response, endpoint);

    // Тело как у необработанной ошибки: детали незадекларированного отказа
    // клиенту не уходят
    return {
      isSuccess: false,
      status: InternalError.category,
      value: {
        ...unhandledBody(originalError, exposeErrorDetails),
        code: InternalError.code,
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
    code: InternalError.code,
  };

  if (exposeErrorDetails && error instanceof Error && error.stack) {
    body.stack = error.stack;
  }

  return body;
}

/**
 * Создаёт пайплайн из одного слоя.
 *
 * @template TReq - Требования слоя к внешнему контексту; их проверяет
 * компилятор в `compose`
 *
 * @example
 * ```typescript
 * const base = makePipeline().pre(withRequestId());
 * const withIdempotency = makePipeline<{ requestId: string }>()
 *   .pre(withIdempotencyKey())
 *   .catch(mapIdempotencyError);
 * const pipeline = compose(base, withIdempotency);
 * ```
 */
export function makePipeline<
  TReq extends AnyInput = EmptyInput,
>(): PipelineBuilder<TReq, TReq, never, never> {
  return PipelineImpl.emptyLayer() as unknown as PipelineBuilder<
    TReq,
    TReq,
    never,
    never
  >;
}

/**
 * Складывает слои в один пайплайн. Список читается сверху вниз как
 * «снаружи внутрь»: `.pre`-шаги выполняются снаружи внутрь,
 * `.ok`/`.catch` и `.finally` — изнутри наружу. Требования каждого слоя к
 * внешнему контексту проверяет компилятор.
 */
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  FA extends AnyFail,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
  FB extends AnyFail,
>(
  outer: Pipeline<RA, AA, NA, FA>,
  inner: Guard<AA, RB, AB, NB, FB>,
): Pipeline<RA, AA & AB, NA | NB, FA | FB>;
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  FA extends AnyFail,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
  FB extends AnyFail,
  RC extends AnyInput,
  AC extends AnyInput,
  NC,
  FC extends AnyFail,
>(
  outer: Pipeline<RA, AA, NA, FA>,
  middle: Guard<AA, RB, AB, NB, FB>,
  inner: Guard<AA & AB, RC, AC, NC, FC>,
): Pipeline<RA, AA & AB & AC, NA | NB | NC, FA | FB | FC>;
export function compose<
  RA extends AnyInput,
  AA extends AnyInput,
  NA,
  FA extends AnyFail,
  RB extends AnyInput,
  AB extends AnyInput,
  NB,
  FB extends AnyFail,
  RC extends AnyInput,
  AC extends AnyInput,
  NC,
  FC extends AnyFail,
  RD extends AnyInput,
  AD extends AnyInput,
  ND,
  FD extends AnyFail,
>(
  a: Pipeline<RA, AA, NA, FA>,
  b: Guard<AA, RB, AB, NB, FB>,
  c: Guard<AA & AB, RC, AC, NC, FC>,
  d: Guard<AA & AB & AC, RD, AD, ND, FD>,
): Pipeline<RA, AA & AB & AC & AD, NA | NB | NC | ND, FA | FB | FC | FD>;
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
 * Слои сравниваются по ссылке, а не по имени, шагам или структуре.
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
 * Возвращает отказы, объявленные слоями `pipeline`.
 *
 * Объявлением считается второй аргумент `.pre(step, { errors })`.
 * Определения с одним `code` схлопнуты в одно: множество уже сложено
 * `compose` и методами билдера. Значение не пайплайна даёт пустой список.
 *
 * @internal Из этого множества `makeEndpoint` собирает эффективное
 * множество отказов endpoint'а
 */
export function declaredFailsOf(
  pipeline: unknown,
): readonly AnyFailDefinition[] {
  return pipeline instanceof PipelineImpl
    ? PipelineImpl.declaredFailsOf(pipeline)
    : [];
}

/**
 * Проверяет, что `pipeline` несёт признак досрочного успеха: хоть один
 * его `.pre`-шаг подключён как `.pre(step, { done: true })`.
 *
 * Значение не пайплайна даёт `false`.
 *
 * @internal По этому признаку `makeEndpoint` проверяет, что у декларации
 * со слоем нет `output`
 */
export function declaresDone(pipeline: unknown): boolean {
  return pipeline instanceof PipelineImpl
    ? PipelineImpl.declaresDone(pipeline)
    : false;
}

/**
 * Проверяет, что `pipeline` объявил контекстную переменную `variable`.
 *
 * Объявлением считается только `.pre`-шаг вида `<Var>.provide(…)`. Шаг,
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
