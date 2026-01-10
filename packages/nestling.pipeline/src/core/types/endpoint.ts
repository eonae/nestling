import type {
  AnyInput,
  AnyMeta,
  AnyOutput,
  InferInput,
  InferOutput,
} from '../io/io.js';
import type { Output, OutputSync } from '../result.js';

/**
 * Интерфейс endpoint с типизированным pipeline
 *
 * Handler получает ТОЛЬКО input и meta.
 * Никакого raw, никакого endpoint metadata!
 *
 * @param TInput - тип провалидированных входных данных
 * @param TMeta - тип метаданных от pipeline
 * @param TOutput - тип выходных данных
 */
export interface IEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
> {
  handle(
    input: InferInput<I>,
    meta: M,
  ): OutputSync<InferOutput<O>> | Output<InferOutput<O>>;
}

/**
 * Функция-обработчик запроса
 */
export type HandlerFn<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
> = IEndpoint<I, O, M>['handle'];
