import type { AnyInput, AnyOutput, InferInput, InferOutput } from '../io';
import type { Output, OutputSync } from '../result.js';

import type { Infer, Optional, Schema } from '@common/misc';

/**
 * Интерфейс для handler-классов
 * Используется для явной реализации контракта
 * Handler может вернуть Success или выбросить Failure
 */
export interface IEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
> {
  handle(
    payload: InferInput<I>,
    metadata: Infer<M>,
  ): OutputSync<InferOutput<O>> | Output<InferOutput<O>>;
}

/**
 * Функция-обработчик запроса
 */
export type HandlerFn<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends Optional<Schema> = Optional<Schema>,
> = IEndpoint<I, O, M>['handle'];
