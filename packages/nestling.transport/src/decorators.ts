import type { Constructor, Infer, MaybeSchema } from '@common/misc';
import type { IMiddleware, ResponseContext } from '@nestling/transport';

/**
 * Метаданные handler-класса
 */
export interface HandlerMetadata<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  transport: string;
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
  className: string;
}

/**
 * Symbol-ключ для хранения метаданных handler-класса
 */
const HANDLER_KEY = Symbol.for('nestling:handler');

/* ============================================================
 * Handler-классы с полной проверкой типов
 * ============================================================ */

/**
 * Конфигурация handler-класса
 */
export interface HandlerClassConfig<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
> {
  transport: string;
  method: string;
  path: string;
  input?: {
    body?: 'json' | 'raw' | 'stream';
    multipart?: {
      files: 'stream' | 'buffer';
    };
  };
  payloadSchema?: P;
  metadataSchema?: M;
  responseSchema?: R;
}

/**
 * Декоратор для handler-классов с полной проверкой типов.
 *
 * КЛЮЧЕВОЕ ПРЕИМУЩЕСТВО:
 * - TypeScript РЕАЛЬНО проверяет сигнатуру handle()
 * - Типы выводятся АВТОМАТИЧЕСКИ из схем
 * - Нельзя ошибиться в типах параметров!
 * - Один класс = один endpoint (Single Responsibility)
 *
 * @example
 * ```typescript
 * const PayloadSchema = z.object({ id: z.string() });
 * const MetadataSchema = z.object({ authToken: z.string() });
 * const ResponseSchema = z.object({ name: z.string() });
 *
 * @Handler({
 *   transport: 'http',
 *   method: 'GET',
 *   path: '/users/:id',
 *   payloadSchema: PayloadSchema,
 *   metadataSchema: MetadataSchema,
 *   responseSchema: ResponseSchema,
 * })
 * class GetUser {
 *   async handle(payload, metadata) {
 *     // payload: { id: string } - выводится автоматически!
 *     // metadata: { authToken: string } - выводится автоматически!
 *
 *     return {
 *       status: 200,
 *       value: { name: "Alice" },
 *       meta: {},
 *     };
 *   }
 * }
 * ```
 */
export function Handler<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
>(config: HandlerClassConfig<P, M, R>) {
  return <
    T extends Constructor<{
      handle(
        payload: Infer<P>,
        metadata: Infer<M>,
      ): Promise<ResponseContext<Infer<R>>>;
    }>,
  >(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[HANDLER_KEY] = {
      ...config,
      className: context.name,
    };

    return target;
  };
}

/**
 * Извлекает метаданные handler-класса
 */
export function getHandlerMetadata<
  P extends MaybeSchema = MaybeSchema,
  M extends MaybeSchema = MaybeSchema,
  R extends MaybeSchema = MaybeSchema,
>(target: any): HandlerMetadata<P, M, R> | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[HANDLER_KEY] || null;
}

/* ============================================================
 * Middleware-классы
 * ============================================================ */

/**
 * Метаданные middleware-класса
 */
export interface MiddlewareMetadata {
  className: string;
}

/**
 * Symbol-ключ для хранения метаданных middleware-класса
 */
const MIDDLEWARE_KEY = Symbol.for('nestling:middleware');

/**
 * Декоратор для middleware-классов.
 *
 * @example
 * ```typescript
 * @Middleware()
 * class TimingMiddleware {
 *   async apply(ctx: RequestContext, next: () => Promise<ResponseContext>) {
 *     const start = Date.now();
 *     const response = await next();
 *     response.meta = {
 *       ...response.meta,
 *       timing: Date.now() - start,
 *     };
 *     return response;
 *   }
 * }
 * ```
 */
export function Middleware() {
  return <T extends Constructor<IMiddleware>>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): T => {
    // Сохраняем конфигурацию в метаданных класса
    (target as any)[MIDDLEWARE_KEY] = {
      className: context.name,
    };

    return target;
  };
}

/**
 * Извлекает метаданные middleware-класса
 */
export function getMiddlewareMetadata(target: any): MiddlewareMetadata | null {
  const constructor = target.prototype ? target : target.constructor;
  return constructor[MIDDLEWARE_KEY] || null;
}
