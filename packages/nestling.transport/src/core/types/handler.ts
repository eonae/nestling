import type { Infer, MaybeSchema } from './common.js';
import type { ResponseContext } from './context.js';

/**
 * Интерфейс для handler-классов
 * Используется для явной реализации контракта
 */
export interface IHandler<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  handle(
    payload: Infer<P>,
    metadata: Infer<M>,
  ): Promise<ResponseContext<Infer<R>>>;
}

/**
 * Обработчик запроса (функциональный стиль)
 */
export type HandlerFn<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> = IHandler<P, M, R>['handle'];
