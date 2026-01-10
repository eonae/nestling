import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
} from '../io/io.js';
import type { Output, OutputSync } from '../result.js';

/**
 * Заменяет тип поля payload в объекте T на новый тип P
 *
 * Если поле payload существует в T, оно заменяется на P.
 * Если поля payload нет, тип T возвращается без изменений.
 */
export type ReplacePayload<T, P> = T extends { payload: unknown }
  ? Omit<T, 'payload'> & { payload: P }
  : T;

/**
 * Интерфейс endpoint с типизированным pipeline
 *
 * Handler получает:
 * - Все поля из выходного типа pipeline (TInput)
 * - Поле payload заменяется на типизированный InferInput<I>
 *
 * @param I - схема input (для типизации payload)
 * @param O - схема output
 * @param TInput - выходной тип pipeline (по умолчанию пустой объект)
 */
export interface IEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
> {
  handle(
    input: ReplacePayload<P, InferInput<I>>,
  ): OutputSync<InferOutput<O>> | Output<InferOutput<O>>;
}

/**
 * Функция-обработчик запроса
 */
export type HandlerFn<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  P extends AnyPayload = AnyPayload,
> = IEndpoint<I, O, P>['handle'];
