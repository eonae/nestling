import type { AnyInput, AnyOutput, InferInput, InferOutput } from '../io';

import type { ResponseContext } from './context.js';

import type { Infer, Optional, Schema } from '@common/misc';

/**
 * Интерфейс для handler-классов
 * Используется для явной реализации контракта
 * Может возвращать либо полный ResponseContext, либо просто value (shorthand)
 */
export interface IEndpoint<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> {
  handle(
    payload: InferInput<I>,
    metadata: Infer<M>,
  ): Promise<ResponseContext<InferOutput<O>> | InferOutput<O>>;
}

/**
 * Обработчик запроса (функциональный стиль)
 */
export type HandlerFn<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> = IEndpoint<I, O, M>['handle'];
