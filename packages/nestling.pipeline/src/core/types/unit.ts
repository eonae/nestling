/* eslint-disable @typescript-eslint/no-invalid-void-type --
 * void в union'ах возвратов — осознанно: юниты-наблюдатели пишутся как
 * обычные функции без return, и это поддерживаемая форма API */
import type {
  ErrorResponseContext,
  ExtendableContext,
  ResponseContext,
  SuccessResponseContext,
} from './context.js';

import type { Constructor, Optional } from '@common/misc';
import type { AnyFail, AnyInput, EmptyInput } from '@nestling/contracts';

/**
 * Добавка pre-юнита к накопленному input
 */
export type AnyAddition = Record<string, unknown>;

/**
 * Исход выполнения запроса (передаётся в `.finally`-юниты).
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
 * Тип input для юнитов ответного тракта: поля собственного pre-тракта
 * опциональны (обогащение могло не случиться — pre упал раньше),
 * требования слоя к внешнему контексту (`TReq`) — гарантированы
 * (слой исполняется только после pre внешних слоёв).
 */
export type ResponseTrackInput<
  TReq extends AnyInput,
  TAcc extends AnyInput,
> = TReq & Partial<Omit<TAcc, keyof TReq>>;

/**
 * Pre-юнит (функциональная форма): получает контекст, возвращает добавку
 * к накопленному input (или ничего).
 */
export type PreUnitFn<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
> = (
  ctx: ExtendableContext<TInput>,
) => Promise<TAddition | undefined | void> | TAddition | undefined | void;

/**
 * Ok-юнит: вызывается только для успешного ответа, видит ПОЛНЫЙ
 * накопленный контекст (успех гарантирует, что весь pre-тракт прошёл).
 * Может заменить ответ, вернув новый успешный ответ; `undefined`/`void`
 * оставляет текущий. Замена успеха на ошибку невозможна по типам —
 * успех приходит только из хендлера (ограничение v1).
 */
export type OkUnitFn<TAcc extends AnyInput = AnyInput> = (
  res: SuccessResponseContext,
  ctx: ExtendableContext<TAcc>,
) =>
  | Promise<SuccessResponseContext | undefined | void>
  | SuccessResponseContext
  | undefined
  | void;

/**
 * Catch-юнит: вызывается только для ответа-ошибки. Поля собственного
 * pre-тракта — Partial. Может заменить ошибку другой ошибкой;
 * восстановление `Fail → Ok` невозможно по типам (ограничение v1).
 *
 * Замена возвращается либо готовым `ErrorResponseContext`, либо просто
 * отказом: `Fail` рантайм нормализует так же, как отказ хендлера —
 * иначе юниту пришлось бы собирать контекст ответа руками. Это же
 * легальное место, где недекларированный отказ становится контрактным:
 * страж границы стоит после всего ответного тракта.
 */
export type CatchUnitFn<TCtxInput extends AnyInput = AnyInput> = (
  res: ErrorResponseContext,
  ctx: ExtendableContext<TCtxInput>,
) =>
  | Promise<ErrorResponseContext | AnyFail | undefined | void>
  | ErrorResponseContext
  | AnyFail
  | undefined
  | void;

/**
 * Finally-юнит: наблюдатель исхода. Вызывается всегда, последним,
 * с исходом и итоговым ответом. Не может менять ответ; брошенная им
 * ошибка не влияет на ответ (проглатывается рантаймом) — finally-юнит
 * обязан обрабатывать свои ошибки сам.
 */
export type FinallyUnitFn<TCtxInput extends AnyInput = AnyInput> = (
  outcome: Outcome,
  res: ResponseContext,
  ctx: ExtendableContext<TCtxInput>,
) => Promise<void> | void;

/**
 * Инстанс-форма юнита: объект с методом `handle` (мост для классов без DI).
 */
export interface UnitInstance<F> {
  handle: F;
}

/**
 * Юнит в одной из трёх форм: функция, инстанс, класс.
 *
 * Класс-форма откладывает создание: конструктор попадает в `TNeeds`
 * пайплайна и резолвится контейнером на старте приложения (`bind`).
 * Контракт всех форм: юнит — синглтон, per-request состояние — только в ctx.
 */
export type UnitLike<F> = F | UnitInstance<F> | Constructor<UnitInstance<F>>;
