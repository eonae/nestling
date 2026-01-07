import type { AnyInput, AnyOutput } from './io/io.js';
import type { HandlerFn } from './types';

import type { Optional, Schema } from '@common/misc';

/**
 * Конфигурация для регистрации handler в транспорте
 */
export interface HandlerConfig<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
> {
  transport: string;
  pattern: string;

  /** Конфигурация входных данных */
  input?: I;

  /** Схема метаданных */
  metadata?: M;

  /** Конфигурация выходных данных */
  output?: O;

  handle: HandlerFn<I, O, M>;
}

/**
 * Вспомогательная функция для создания конфигурации handler'а с корректным выводом типов.
 *
 * Решает проблему вывода дженерик-типов при явной типизации объекта конфигурации.
 *
 * @example
 * ```typescript
 * const config = makeEndpoint({
 *   transport: 'http',
 *   pattern: '/users',
 *   input: CreateUserSchema,
 *   output: CreateUserResponseSchema,
 *   handle: async (payload) => {
 *     // payload типизирован автоматически!
 *     return { status: 201, value: {...}, meta: {} };
 *   },
 * });
 * ```
 */
export function makeEndpoint<
  I extends AnyInput = Schema,
  O extends AnyOutput = Schema,
  M extends Optional<Schema> = Optional<Schema>,
>(config: HandlerConfig<I, O, M>): HandlerConfig<I, O, M> {
  return config;
}
