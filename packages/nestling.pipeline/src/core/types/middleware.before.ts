import type { AnyInput, EmptyInput } from '../io/io.js';

import type { ExtendableContext } from './context.js';

import type { Optional } from '@common/misc';

export type AnyAddition = Record<string, unknown>;

/**
 * Интерфейс для классовых middleware
 */
export interface IMiddleware<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
> {
  handle: (ctx: ExtendableContext<TInput>) => Promise<TAddition | undefined>;
}

export type MiddlewareFn<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
> = IMiddleware<TInput, TAddition>['handle'];

export type MiddlewareInstanceOrFunction<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
> = IMiddleware<TInput, TAddition> | MiddlewareFn<TInput, TAddition>;

/**
 * Проверяет, является ли middleware классом
 */
export function isMiddlewareClass<
  TInput extends AnyInput = EmptyInput,
  TAddition extends Optional<AnyAddition> = undefined,
>(
  mw: MiddlewareInstanceOrFunction<TInput, TAddition>,
): mw is IMiddleware<TInput, TAddition> {
  return typeof mw !== 'function' && typeof mw.handle === 'function';
}

/**
 * Приводит middleware к функциональной форме
 */
export function normalizeMiddleware<
  TInput extends AnyInput,
  TAddition extends AnyAddition,
>(
  mw: MiddlewareInstanceOrFunction<TInput, TAddition>,
): MiddlewareFn<TInput, TAddition> {
  if (isMiddlewareClass(mw)) {
    return mw.handle.bind(mw);
  }
  return mw;
}
