import type {
  AnyFail,
  AnyInput,
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
  Output,
  OutputSync,
  ValidateHandlerFails,
} from '@nestlingjs/operations';

/**
 * Второй параметр хендлера: поля пайплайна без `payload` плюс
 * зарезервированный ключ `signal`.
 */
type HandlerMetaOf<P extends AnyInput> = (P extends { payload: unknown }
  ? Omit<P, 'payload'>
  : P) & {
  signal: AbortSignal;
};

/**
 * Функция-обработчик запроса.
 *
 * Хендлер получает два отдельных параметра:
 * - payload: данные от пользователя, проверенные рантаймом по схеме
 *   `input` и типизированные ею (InferInput<I>)
 * - meta: все остальные поля из пайплайна (P без payload) плюс
 *   зарезервированный ключ `signal: AbortSignal` (сигнал отмены запроса)
 *
 * Это единственная форма хендлера на уровне рантайма: две
 * пользовательские формы (`(input, meta) => …` и класс с методом
 * `handle`) нормализуются к ней конструктором декларации
 * (`makeEndpoint`). Интерфейса `IEndpoint` в V1 нет — сверка сигнатуры со
 * схемами `input`/`output` и со списком `errors:` происходит в точке
 * декларации.
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - тип результата пайплайна (накопленный input, по умолчанию
 * пустой объект)
 * @param E - множество объявленных отказов (`errors:` декларации). По
 * умолчанию пусто: без декларации хендлер не может **вернуть** отказ —
 * иначе типы разрешали бы то, что граница превратит в `InternalError`.
 */
export type HandlerFn<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = (
  payload: InferInput<I>,
  meta: HandlerMetaOf<P>,
) => OutputSync<InferOutput<O>, E> | Output<InferOutput<O>, E>;

/**
 * Результат хендлера с любым отказом: ограничение слота `handler` формы с
 * функцией.
 *
 * Ограничение пропускает любой отказ, потому что множество отказов
 * проверяет бренд `ValidateHandlerFails` в возвращаемом типе. Проверку
 * значения `Ok` ограничение держит по-прежнему.
 */
export type AnyHandlerResult<O extends AnyOutput = AnyOutput> =
  | OutputSync<InferOutput<O>, AnyFail>
  | Output<InferOutput<O>, AnyFail>;

/**
 * Слот `handler` формы с функцией: сигнатура `HandlerFn` с проверкой
 * множества отказов в возвращаемом типе.
 *
 * Отдельный тип, потому что проверка обязана видеть выведенный результат
 * `R`; `HandlerFn` его не параметризует. Причина, по которой проверка
 * стоит здесь, а не в слоте, — в JSDoc `ValidateHandlerFails`.
 *
 * @param R - Тип результата, выведенный из тела хендлера
 */
export type CheckedHandlerFn<
  I extends AnyPayload,
  P extends AnyInput,
  E extends AnyFail,
  R,
> = (
  payload: InferInput<I>,
  meta: HandlerMetaOf<P>,
) => R & ValidateHandlerFails<R, E>;
