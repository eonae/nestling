import type { HandlerFn } from './types';

import type { MaybeSchema } from '@common/misc';

/**
 * Конфигурация для регистрации handler в транспорте
 */
export interface HandlerConfig<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  transport: string;
  pattern: string;
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
  handle: HandlerFn<P, M, R>;
}

/**
 * Вспомогательная функция для создания конфигурации handler'а с корректным выводом типов.
 *
 * Решает проблему вывода дженерик-типов при явной типизации объекта конфигурации.
 *
 * @example
 * ```typescript
 * const config = makeHandler({
 *   transport: 'http',
 *   pattern: '/users',
 *   payloadSchema: CreateUserSchema,
 *   responseSchema: CreateUserResponseSchema,
 *   handler: async (payload) => {
 *     // payload типизирован автоматически!
 *     return { status: 201, value: {...}, meta: {} };
 *   },
 * });
 * ```
 */
export function makeHandler<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
>(config: HandlerConfig<P, M, R>): HandlerConfig<P, M, R> {
  return config as HandlerConfig<P, M, R>;
}
