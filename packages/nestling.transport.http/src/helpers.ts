import type { Constructor } from '@common/misc';
import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  IEndpoint,
  Pipeline,
} from '@nestling/pipeline';
import { makeEndpoint } from '@nestling/pipeline';
import type { HTTPMethod } from 'find-my-way';

/**
 * Опции для HttpEndpoint декоратора
 *
 * @param I - конфигурация payload (schema, примитив или модификатор)
 * @param O - конфигурация output
 * @param P - тип результата pipeline (накопленный input)
 */
export interface HttpEndpointOptions<
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> {
  /** Schema или модификатор для input */
  input?: I;

  /** Schema для output (опционально) */
  output?: O;

  /**
   * Pipeline для обработки запроса.
   * Для endpoint'ов с input схемой должен содержать `.pre(validate())`.
   * Классы-юниты (`TNeeds` ≠ never) допустимы под App — он резолвит их
   * контейнером на старте; standalone-использование требует `bind`.
   */
  pipeline?: Pipeline<AnyInput, P, unknown>;

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
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
> {
  transport: 'http';
  pattern: string;
  method: HTTPMethod;
  path: string;

  /** Schema для валидации input */
  input?: I;

  /** Schema для output (опционально) */
  output?: O;

  /** Pipeline для этого endpoint (классы-юниты резолвит App через bind) */
  pipeline?: Pipeline<AnyInput, P, unknown>;

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
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
>(method: HTTPMethod, path: string, options: HttpEndpointOptions<I, O, P>) {
  return <T extends Constructor<IEndpoint<I, O, P>>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем метаданные
    const metadata: HttpEndpointMetadata<I, O, P> = {
      transport: 'http',
      pattern: `${method} ${path}`,
      method,
      path,
      input: options.input,
      output: options.output,
      pipeline: options.pipeline,
      rateLimit: options.rateLimit,
      audit: options.audit,
      cache: options.cache,
      className: context.name,
    };

    // Декоратор только пишет метаданные класса: приложение собирает
    // эндпоинты обходом дерева зарегистрированных модулей
    const HANDLER_KEY = Symbol.for('nestling:handler');
    (target as any)[HANDLER_KEY] = metadata;

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
  I extends AnyPayload = AnyPayload,
  O extends AnyOutput = AnyOutput,
  P extends AnyInput = AnyInput,
>(
  method: HTTPMethod,
  path: string,
  meta: Omit<EndpointDefinition<I, O, P>, 'transport' | 'pattern'>,
): EndpointDefinition<I, O, P> {
  return makeEndpoint({
    transport: 'http',
    pattern: `${method} ${path}`,
    ...meta,
  });
}
