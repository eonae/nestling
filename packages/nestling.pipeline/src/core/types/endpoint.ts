import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  InferInput,
  InferOutput,
} from '../io/io.js';
import type { Output, OutputSync } from '../result.js';

/**
 * Интерфейс endpoint с типизированным pipeline
 *
 * Handler получает два отдельных параметра:
 * - payload: типизированные данные от пользователя (InferInput<I>)
 * - meta: все остальные поля из pipeline (P без payload) плюс
 *   гарантированный `signal: AbortSignal` — сигнал отмены запроса
 *   (ключ `signal` зарезервирован pipeline'ом)
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - тип результата pipeline (накопленный input, по умолчанию пустой объект)
 */
export interface IEndpoint<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> {
  handle(
    payload: InferInput<I>,
    meta: (P extends { payload: unknown } ? Omit<P, 'payload'> : P) & {
      signal: AbortSignal;
    },
  ): OutputSync<InferOutput<O>> | Output<InferOutput<O>>;
}

/**
 * Функция-обработчик запроса
 */
export type HandlerFn<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> = IEndpoint<I, O, P>['handle'];
