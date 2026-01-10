import type { AnyInput } from './io/io.js';
import type {
  AnyContext,
  AnyMeta,
  EmptyContext,
  ErrorDetails,
  NextContext,
  ResponseContext,
  UnvalidatedContext,
  ValidatedContext,
} from './types/context.js';
/**
 * Type helpers
 */
import type {
  MiddlewareFn,
  MiddlewareFnOrInstance,
} from './types/middleware.js';
import { normalizeMiddleware } from './types/middleware.js';
import type { Output, OutputSync } from './result.js';
import { Fail, Ok } from './result.js';

/**
 * Типизированный pipeline
 *
 * CIn  - входной тип контекста (всегда UnvalidatedContext<EmptyMeta> для нового pipeline)
 * COut - выходной тип контекста (ValidatedContext<I, M> или UnvalidatedContext<M>)
 *
 * Pipeline иммутабельный: каждый .use() возвращает новый экземпляр.
 * Это позволяет безопасно переиспользовать базовые pipeline'ы.
 */
export class Pipeline<
  I extends AnyInput,
  M extends AnyMeta,
  COut extends AnyContext<I, M>,
> {
  /**
   * Приватный конструктор - создание только через static методы
   */
  private constructor(
    private readonly middlewares: MiddlewareFn<any, any, any, any, any>[],
  ) {}

  /**
   * Создаёт пустой pipeline с пустым meta
   */
  static empty(): Pipeline<AnyInput, AnyMeta, EmptyContext> {
    return new Pipeline([]);
  }

  /**
   * Добавляет middleware в конец цепочки
   * Возвращает новый pipeline с обновлённым типом
   */
  use<N extends M, CNext extends NextContext<COut, I, M, N>>(
    middleware: MiddlewareFnOrInstance<I, M, N, COut, CNext>,
  ): Pipeline<I, M, CNext> {
    return new Pipeline([...this.middlewares, normalizeMiddleware(middleware)]);
  }

  /**
   * Выполняет pipeline с handler
   *
   * @param handler - бизнес-логика endpoint (получает только input и meta)
   * @param ctx - начальный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (input: I, meta: M) => OutputSync<TOutput> | Output<TOutput>,
    ctx: COut,
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentCtx: AnyContext<I, M> = ctx;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        let nextCalled = false;
        let nextCtx: AnyContext<I, M> | undefined;

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

        if (!nextCtx) {
          throw new Error(
            'Middleware called next() but did not provide context',
          );
        }

        currentCtx = nextCtx;
      }
      // Вызываем handler только с input и meta
      // Handler НЕ получает raw и endpoint!
      const result = await handler(
        (currentCtx as ValidatedContext<I, M>).input as I, // FIXME: Костыль
        currentCtx.meta,
      );
      return this.normalizeResponse(result);
    } catch (error) {
      return this.errorToResponse(error);
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
  private errorToResponse(error: unknown): ResponseContext<never> {
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
 * Создаёт пустой pipeline с пустым meta
 * Fluent API entry point
 */
export function definePipeline(): Pipeline<AnyInput, AnyMeta, EmptyContext> {
  return Pipeline.empty();
}

/** Извлекает TMeta из pipeline */
export type InferPipelineMeta<P> =
  P extends Pipeline<any, any, ValidatedContext<any, infer M>>
    ? M
    : P extends Pipeline<any, any, UnvalidatedContext<infer M>>
      ? M
      : never;

/** Проверяет, содержит ли pipeline validate() */
export type HasValidation<P> =
  P extends Pipeline<any, any, ValidatedContext<any, any>> ? true : false;
