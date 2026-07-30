import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
} from '../io/io.js';
import type { Output, OutputSync } from '../result.js';

/**
 * Функция-обработчик запроса.
 *
 * Handler получает два отдельных параметра:
 * - payload: типизированные данные от пользователя (InferInput<I>)
 * - meta: все остальные поля из pipeline (P без payload) плюс
 *   гарантированный `signal: AbortSignal` — сигнал отмены запроса
 *   (ключ `signal` зарезервирован pipeline'ом)
 *
 * Это единственная форма хендлера на уровне рантайма: три пользовательские
 * формы (`(input, meta) => …`, каррированная фабрика, класс с методом
 * `handle`) нормализуются к ней конструктором декларации
 * (`makeEndpoint`). Интерфейса `IEndpoint` в V1 нет — сверка сигнатуры со
 * схемами `input`/`output` происходит в точке декларации.
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - тип результата pipeline (накопленный input, по умолчанию пустой объект)
 */
export type HandlerFn<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> = (
  payload: InferInput<I>,
  meta: (P extends { payload: unknown } ? Omit<P, 'payload'> : P) & {
    signal: AbortSignal;
  },
) => OutputSync<InferOutput<O>> | Output<InferOutput<O>>;
