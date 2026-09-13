import type {
  AnyOutput,
  InferOutput,
  OutcomeMap,
  OutcomesForm,
  OutcomeValue,
} from './io/index.js';
import type { KernelFail } from './kernel-fails.js';
import type { AnyFailDefinition, FailOf, FailOfDef } from './make-fail.js';
import type { AnyFail, Ok } from './result.js';
import type { SuccessStatus } from './status.js';

/**
 * Отказы, которые хендлер возвращает без объявления в `errors:`.
 *
 * Это отказы ядра: их порождает рантайм, и граница пропускает их у любого
 * endpoint'а. Правило типов повторяет правило границы, поэтому проброс
 * результата порта после `if (result.isFail)` не требует приведения типов.
 */
type KernelOutput = FailOf<KernelFail>;

/**
 * `Ok` без значения: `Ok.noContent()` и `new Ok(null)`.
 *
 * Допустим только у декларации без `output`, где тип значения — `void`.
 * У декларации со схемой `Ok<null>` остаётся ошибкой: значение объявлено.
 */
/* eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- `void` — тип значения у декларации без `output`; сравнение с ним и есть признак «ответ без значения» */
type NoContentOk<TValue> = [TValue] extends [void]
  ? Ok<null, 'no_content'>
  : never;

/**
 * Синхронный результат хендлера: `Ok`, значение без обёртки, отказ из
 * множества `E` или отказ ядра.
 *
 * `E` записывается определениями отказов (`typeof UserNotFound`, юнион
 * через `|`) или типами `Fail`. По умолчанию `E` равно `never`: endpoint
 * без `errors` не может вернуть доменный отказ. Отказ ядра он вернуть
 * может: граница пропускает его без объявления.
 *
 * `S` — объявленный статус единственного исхода; по умолчанию `ok`.
 * `Ok` с другим статусом в этот тип не попадает: объявленный исход один,
 * и отдать другой значит разойтись с документом. Несколько исходов
 * объявляются развилкой `outputs(...)`, и тип их результата собирает
 * {@link DeclaredOutputSync}.
 *
 * У декларации без `output` тип значения — `void`, поэтому хендлер без
 * `return` компилируется.
 */
export type OutputSync<
  TValue = unknown,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = 'ok',
> = Ok<TValue, S> | NoContentOk<TValue> | FailOfDef<E> | KernelOutput | TValue;

/**
 * Асинхронный результат хендлера (см. {@link OutputSync}).
 *
 * @example
 * ```typescript
 * async handle(input: GetUserInput): Output<User, typeof UserNotFound> {
 *   return (await this.users.byId(input.id)) ?? UserNotFound({ id: input.id });
 * }
 * ```
 */
export type Output<
  TValue = unknown,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = 'ok',
> = Promise<OutputSync<TValue, E, S>>;

/**
 * Статус единственного исхода: объявленный полем `status` или умолчание.
 *
 * Умолчание считается здесь один раз и совпадает с умолчанием рантайма:
 * `ok` при объявленном `output`, `no_content` без него.
 */
export type EffectiveStatus<O, S extends SuccessStatus = never> = [S] extends [
  never,
]
  ? [O] extends [undefined]
    ? 'no_content'
    : 'ok'
  : S;

/**
 * Объявленное множество статусов декларации: ключи развилки или статус
 * единственного исхода.
 */
export type DeclaredStatuses<O, S extends SuccessStatus = never> =
  O extends OutcomesForm<infer M>
    ? keyof M & SuccessStatus
    : EffectiveStatus<O, S>;

/**
 * Дискриминированный юнион `Ok` по исходам развилки: у каждой ветки свой
 * статус и своё значение.
 */
export type OutcomeOks<M extends OutcomeMap> = {
  [K in keyof M & SuccessStatus]: Ok<OutcomeValue<M[K]>, K>;
}[keyof M & SuccessStatus];

/**
 * Результат хендлера, выведенный из объявленных исходов декларации.
 *
 * У развилки это юнион `Ok` по статусам: проверка
 * `result.status === 'accepted'` сужает `value` до типа ветки. Голого
 * значения в юнионе нет — при развилке исход выбирает ветка исполнения.
 *
 * У декларации с одной формой `output` — обычный {@link OutputSync} со
 * статусом этого исхода.
 *
 * @param O - Форма `output` декларации или её развилка
 * @param E - Объявленные отказы
 * @param S - Статус, объявленный полем `status`
 */
export type DeclaredOutputSync<
  O extends AnyOutput,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = never,
> =
  O extends OutcomesForm<infer M>
    ? OutcomeOks<M> | FailOfDef<E> | KernelOutput
    : OutputSync<InferOutput<O>, E, EffectiveStatus<O, S>>;

/** Асинхронный результат хендлера по объявленным исходам */
export type DeclaredOutput<
  O extends AnyOutput,
  E extends AnyFailDefinition | AnyFail = never,
  S extends SuccessStatus = never,
> = Promise<DeclaredOutputSync<O, E, S>>;
