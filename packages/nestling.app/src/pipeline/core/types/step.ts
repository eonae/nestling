/* eslint-disable @typescript-eslint/no-invalid-void-type --
 * void в union'ах возвратов — осознанно: шаги-наблюдатели пишутся как
 * обычные функции без return, и это поддерживаемая форма API */
import type { Done } from '../done.js';

import type {
  ErrorResponseContext,
  ExtendableContext,
  ResponseContext,
  SuccessResponseContext,
} from './context.js';

import type { Constructor, Optional } from '@nestlingjs/common.misc';
import type { AnyFail, AnyInput, EmptyInput } from '@nestlingjs/operations';

/**
 * Добавка pre-шага к накопленному input
 */
export type AnyAddition = Record<string, unknown>;

/**
 * Исход выполнения запроса (передаётся в `.finally`-шаги).
 *
 * - `completed` — успешный ответ доставлен;
 * - `failed` — итоговый ответ — ошибка;
 * - `disconnected` — клиент отвалился (сигнал взведён причиной дисконнекта);
 * - `aborted` — отменено иным образом (graceful shutdown и т.п.).
 *
 * Момент вычисления зависит от формы `output`: у не-потоковой — сразу
 * после ответной фазы; у потоковой (`stream`/`events`) — **после
 * завершения отдачи потока**, когда он дотёк, оборвался ошибкой или был
 * закрыт потребителем. Для потоков прежний момент был просто неверным:
 * «completed» печатался до того, как ушёл первый байт.
 */
export type Outcome = 'completed' | 'disconnected' | 'aborted' | 'failed';

/**
 * Тип input для шагов ответной фазы: поля, добавленные собственными
 * pre-шагами слоя, опциональны (обогащение могло не случиться — pre
 * упал раньше), требования слоя к внешнему контексту (`TReq`)
 * гарантированы, потому что слой исполняется только после pre внешних
 * слоёв.
 */
export type ResponseTrackInput<
  TReq extends AnyInput,
  TAcc extends AnyInput,
> = TReq & Partial<Omit<TAcc, keyof TReq>>;

/**
 * Результат pre-шага: добавка к накопленному input, отказ, досрочный
 * успех или ничего.
 */
export type PreResult<
  TAddition extends Optional<AnyAddition>,
  TFail extends AnyFail,
> = TAddition | TFail | Done | undefined | void;

/**
 * Pre-шаг (функциональная форма): получает контекст, возвращает добавку
 * к накопленному input, отказ, досрочный успех или ничего.
 *
 * Отказ объявляется вторым аргументом `.pre(step, { errors })`: вернуть
 * можно только объявленный там отказ или отказ ядра. Возвращённый отказ
 * начинает ответную фазу, и в накопленный input он не попадает.
 *
 * Досрочный успех (`done()`) объявляется там же признаком
 * `{ done: true }`: он завершает endpoint успехом без значения и в
 * накопленный input тоже не попадает.
 */
export type PreStepFn<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
  TFail extends AnyFail = never,
> = (
  ctx: ExtendableContext<TInput>,
) => Promise<PreResult<TAddition, TFail>> | PreResult<TAddition, TFail>;

/**
 * Ok-шаг: вызывается только для успешного ответа, видит полный
 * накопленный контекст (успех гарантирует, что все pre-шаги прошли).
 * Может заменить ответ, вернув новый успешный ответ. `undefined`/`void`
 * оставляет текущий. Заменить успех на ошибку по типам нельзя: успех
 * приходит только из хендлера (ограничение V1).
 */
export type OkStepFn<TAcc extends AnyInput = AnyInput> = (
  res: SuccessResponseContext,
  ctx: ExtendableContext<TAcc>,
) =>
  | Promise<SuccessResponseContext | undefined | void>
  | SuccessResponseContext
  | undefined
  | void;

/**
 * Catch-шаг: вызывается только для ответа-ошибки. Поля, добавленные
 * pre-шагами собственного слоя, — Partial. Может заменить ошибку
 * другой ошибкой. Превратить `Fail` в `Ok` по типам нельзя
 * (ограничение V1).
 *
 * Замена возвращается либо готовым `ErrorResponseContext`, либо просто
 * отказом: `Fail` рантайм нормализует так же, как отказ хендлера —
 * иначе шагу пришлось бы собирать контекст ответа руками. Это же место,
 * где допустимо превратить недекларированный отказ в объявленный:
 * проверка операции отказов стоит после всей ответной фазы.
 */
export type CatchStepFn<TCtxInput extends AnyInput = AnyInput> = (
  res: ErrorResponseContext,
  ctx: ExtendableContext<TCtxInput>,
) =>
  | Promise<ErrorResponseContext | AnyFail | undefined | void>
  | ErrorResponseContext
  | AnyFail
  | undefined
  | void;

/**
 * Finally-шаг: наблюдатель исхода. Вызывается всегда, последним,
 * с исходом и итоговым ответом. Не может менять ответ; брошенная им
 * ошибка не влияет на ответ (проглатывается рантаймом) — finally-шаг
 * обязан обрабатывать свои ошибки сам.
 */
export type FinallyStepFn<TCtxInput extends AnyInput = AnyInput> = (
  outcome: Outcome,
  res: ResponseContext,
  ctx: ExtendableContext<TCtxInput>,
) => Promise<void> | void;

/**
 * Инстанс-форма шага: объект с методом `handle` (мост для классов без DI).
 */
export interface StepInstance<F> {
  handle: F;
}

/**
 * Шаг в одной из трёх форм: функция, инстанс, класс.
 *
 * Класс-форма откладывает создание: конструктор попадает в `TNeeds`
 * пайплайна и резолвится контейнером на старте приложения (`bind`).
 * Операция всех форм: шаг — синглтон, per-request состояние — только в ctx.
 */
export type StepLike<F> = F | StepInstance<F> | Constructor<StepInstance<F>>;
