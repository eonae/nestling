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
export interface IEndpoint<TInput = any, TMeta = any, TOutput = any> {
  handle(input: TInput, meta: TMeta): OutputSync<TOutput> | Output<TOutput>;
}

/**
 * Функция-обработчик запроса
 */
export type HandlerFn<TInput = any, TMeta = any, TOutput = any> = IEndpoint<
  TInput,
  TMeta,
  TOutput
>['handle'];
