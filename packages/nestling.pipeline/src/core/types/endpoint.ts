import type { InferInput, InferOutput, Input, Output } from '../io/io.js';

import type { ResponseContext } from './context.js';

import type { Infer, Optional, Schema } from '@common/misc';

/**
 * Интерфейс для handler-классов
 * Используется для явной реализации контракта
 */
export interface IEndpoint<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> {
  handle(
    payload: InferInput<I>,
    metadata: Infer<M>,
  ): Promise<ResponseContext<InferOutput<O>>>;
}

/**
 * Обработчик запроса (функциональный стиль)
 */
export type HandlerFn<
  I extends Input = Schema,
  O extends Output = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> = IEndpoint<I, O, M>['handle'];
