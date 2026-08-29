import type {
  AnyFail,
  AnyInput,
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
  Output,
  OutputSync,
} from '@nestling/contracts';

/**
 * Функция-обработчик запроса.
 *
 * Хендлер получает два отдельных параметра:
 * - payload: типизированные данные от пользователя (InferInput<I>)
 * - meta: все остальные поля из пайплайна (P без payload) плюс два
 *   зарезервированных ключа — `signal: AbortSignal` (сигнал отмены
 *   запроса) и `fail(e): never` (типизированный ранний выход)
 *
 * Это единственная форма хендлера на уровне рантайма: три пользовательские
 * формы (`(input, meta) => …`, каррированная фабрика, класс с методом
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
 * иначе типы разрешали бы то, что граница превратит в `UnknownError`.
 */
export type HandlerFn<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
  E extends AnyFail = never,
> = (
  payload: InferInput<I>,
  meta: (P extends { payload: unknown } ? Omit<P, 'payload'> : P) & {
    signal: AbortSignal;
    fail: (e: E) => never;
  },
) => OutputSync<InferOutput<O>, E> | Output<InferOutput<O>, E>;
