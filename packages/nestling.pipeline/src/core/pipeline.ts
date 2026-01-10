import type {
  AnyContext,
  ErrorDetails,
  ResponseContext,
  UnvalidatedContext,
  ValidatedContext,
} from './types/context.js';
/**
 * Type helpers
 */
import type { Middleware, MiddlewareFn } from './types/middleware.js';
import { normalizeMiddleware } from './types/middleware.js';
import type { Output, OutputSync } from './result.js';
import { Fail, Ok } from './result.js';

/**
 * Типизированный pipeline
 *
 * CIn  - входной тип контекста (обычно UnvalidatedContext<{}>)
 * COut - выходной тип контекста (ValidatedContext<I, M> или UnvalidatedContext<M>)
 *
 * Pipeline иммутабельный: каждый .use() возвращает новый экземпляр.
 * Это позволяет безопасно переиспользовать базовые pipeline'ы.
 */
export class Pipeline<CIn extends UnvalidatedContext, COut extends AnyContext> {
  /**
   * Приватный конструктор - создание только через static методы
   */
  private constructor(private readonly middlewares: MiddlewareFn<any, any>[]) {}

  /**
   * Создаёт пустой pipeline
   */
  static empty(): Pipeline<UnvalidatedContext, UnvalidatedContext> {
    return new Pipeline([]);
  }

  /**
   * Добавляет middleware в конец цепочки
   * Возвращает новый pipeline с обновлённым типом
   */
  use<CNext extends AnyContext>(
    middleware: Middleware<COut, CNext>,
  ): Pipeline<CIn, CNext> {
    return new Pipeline([...this.middlewares, normalizeMiddleware(middleware)]);
  }

  /**
   * Выполняет pipeline с handler
   *
   * @param handler - бизнес-логика endpoint (получает только input и meta)
   * @param ctx - начальный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (input: any, meta: any) => OutputSync<TOutput> | Output<TOutput>,
    ctx: CIn,
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentCtx: any = ctx;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        let nextCalled = false;
        let nextCtx: any;

        const response = await middleware(currentCtx, async (newCtx) => {
          nextCalled = true;
          nextCtx = newCtx;
          // Возвращаем placeholder - реальный response будет от handler'а
          return null as any;
        });

        // Если middleware вернул response напрямую (short-circuit)
        if (!nextCalled) {
          return response as ResponseContext<TOutput>;
        }

        currentCtx = nextCtx;
      }

      // Вызываем handler только с input и meta
      // Handler НЕ получает raw и endpoint!
      const result = await handler(currentCtx.input, currentCtx.meta);
      return this.normalizeResponse(result);
    } catch (error) {
      return this.errorToResponse(error) as ResponseContext<TOutput>;
    }
  }

  /**
   * Нормализует результат handler'а в ResponseContext
   */
  private normalizeResponse<T>(result: OutputSync<T>): ResponseContext<T> {
    if (result instanceof Ok) {
      return {
        isSuccess: true,
        status: result.status,
        value: result.value,
        headers: result.headers,
      };
    }

    return {
      isSuccess: true,
      status: 'OK',
      value: result as T,
    };
  }

  /**
   * Конвертирует ошибку в ResponseContext
   */
  private errorToResponse(error: unknown): ResponseContext {
    if (error instanceof Fail) {
      const errorValue: ErrorDetails = {
        error: error.message,
      };

      return {
        isSuccess: false,
        status: error.status,
        value: errorValue,
      };
    }

    // TODO: Переместить в конфигурацию
    const isDevelopment = true;

    const errorValue: ErrorDetails = {
      error: isDevelopment
        ? error instanceof Error
          ? error.message
          : 'Unknown error'
        : 'Internal server error',
    };

    if (isDevelopment && error instanceof Error && error.stack) {
      errorValue.stack = error.stack;
    }

    return {
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: errorValue,
    };
  }
}

/**
 * Создаёт пустой pipeline
 * Fluent API entry point
 */
export function definePipeline(): Pipeline<
  UnvalidatedContext,
  UnvalidatedContext
> {
  return Pipeline.empty();
}

/** Извлекает TMeta из pipeline */
export type InferPipelineMeta<P> =
  P extends Pipeline<any, ValidatedContext<any, infer M>>
    ? M
    : P extends Pipeline<any, UnvalidatedContext<infer M>>
      ? M
      : never;

/** Проверяет, содержит ли pipeline validate() */
export type HasValidation<P> =
  P extends Pipeline<any, ValidatedContext<any, any>> ? true : false;
