import type { Constructor } from '@common/misc';
import type {
  AnyInput,
  AnyMeta,
  AnyOutput,
  EndpointDefinition,
  IEndpoint,
  Pipeline,
  UnvalidatedContext,
  ValidatedContext,
} from '@nestling/pipeline';
import { makeEndpoint, registerEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Опции для HttpEndpoint декоратора (с input схемой)
 *
 * ✅ Требует pipeline с validate()
 */
export interface HttpEndpointOptions<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
> {
  /** Schema или модификатор для input (обязательно) */
  input?: I;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для обработки запроса - ДОЛЖЕН содержать validate() */
  pipeline: Pipeline<UnvalidatedContext<M>, ValidatedContext<I, M>>;

  /** Rate limit конфигурация */
  rateLimit?: unknown;

  /** Включить audit logging */
  audit?: boolean;

  /** Cache конфигурация */
  cache?: unknown;
}

/**
 * Метаданные HTTP endpoint
 */
export interface HttpEndpointMetadata<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
> {
  transport: 'http';
  pattern: string;
  method: HTTPMethod;
  path: string;

  /** Schema для валидации input */
  input?: I;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для этого endpoint */
  pipeline: Pipeline<UnvalidatedContext<M>, ValidatedContext<I, M>>;

  /** Дополнительные опции для middleware */
  rateLimit?: unknown;
  audit?: boolean;
  cache?: unknown;

  /** Имя класса (для отладки) */
  className?: string;

  [key: string]: unknown;
}

// Реализация
export function HttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
>(method: HTTPMethod, path: string, options: HttpEndpointOptions<I, O, M>) {
  return <T extends Constructor<IEndpoint<I, O, M>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    const metadata: HttpEndpointMetadata<I, O, M> = {
      transport: 'http',
      pattern: `${method} ${path}`,
      method,
      path,
      input: options.input,
      output: options.output,
      pipeline: options.pipeline as any,
      rateLimit: options.rateLimit,
      audit: options.audit,
      cache: options.cache,
      className: context.name,
    };

    const HANDLER_KEY = Symbol.for('nestling:handler');
    (target as any)[HANDLER_KEY] = metadata;

    registerEndpoint(target as Constructor<any>);

    return target;
  };
}

/**
 * Извлекает метаданные HTTP endpoint класса
 */
export function getHttpEndpointMetadata(
  target: any,
): HttpEndpointMetadata | null {
  const HANDLER_KEY = Symbol.for('nestling:handler');
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/**
 * Создаёт endpoint definition для HTTP
 */
export function makeHttpEndpoint<
  I extends AnyInput = AnyInput,
  O extends AnyOutput = AnyOutput,
  M extends AnyMeta = AnyMeta,
>(
  method: HTTPMethod,
  path: string,
  meta: Omit<EndpointDefinition<I, O, M>, 'transport' | 'pattern'>,
): EndpointDefinition<I, O, M> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}
