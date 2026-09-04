import type { KernelFail } from './kernel-fails.js';
import type { AnyFailDefinition, FailOf, FailOfDef } from './make-fail.js';
import type { AnyFail, Ok } from './result.js';

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
type NoContentOk<TValue> = [TValue] extends [void] ? Ok<null> : never;

/**
 * Синхронный результат хендлера: `Ok`, значение без обёртки, отказ из
 * множества `E` или отказ ядра.
 *
 * `E` записывается определениями отказов (`typeof UserNotFound`, юнион
 * через `|`) или типами `Fail`. По умолчанию `E` равно `never`: endpoint
 * без `errors` не может вернуть доменный отказ. Отказ ядра он вернуть
 * может: граница пропускает его без объявления.
 *
 * У декларации без `output` тип значения — `void`, поэтому хендлер без
 * `return` компилируется.
 */
export type OutputSync<
  TValue = unknown,
  E extends AnyFailDefinition | AnyFail = never,
> = Ok<TValue> | NoContentOk<TValue> | FailOfDef<E> | KernelOutput | TValue;

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
> = Promise<OutputSync<TValue, E>>;
