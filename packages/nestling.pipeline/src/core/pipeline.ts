import type { AnyInput, EmptyInput } from './io/io.js';
import type {
  ErrorDetails,
  ExtendableContext,
  ResponseContext,
} from './types/context.js';
/**
 * Type helpers
 */
import type {
  AnyAddition,
  IMiddleware,
  MiddlewareFn,
  MiddlewareInstanceOrFunction,
} from './types/middleware.before.js';
import { normalizeMiddleware } from './types/middleware.before.js';
import type { Output, OutputSync } from './result.js';
import { Fail, Ok } from './result.js';

type OverlapKeys<A, B> = keyof A & keyof B;

/**
 * Проверяет совместимость TReq и TAdd с TCurrentInput
 */
type CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M> =
  TCurrentInput extends TReq
    ? OverlapKeys<TCurrentInput, TAdd> extends never
      ? M
      : {
          ERROR: 'Middleware is overriding fields in input';
          CONFLICTING_KEYS: OverlapKeys<TCurrentInput, TAdd>;
          CURRENT_INPUT: TCurrentInput;
          MIDDLEWARE_ADDITION: TAdd;
        }
    : {
        ERROR: 'Input is not assignable to middleware input';
        CURRENT_INPUT: TCurrentInput;
        MIDDLEWARE_EXPECTS: TReq;
      };

/**
 * Валидирует совместимость middleware с текущим input
 */
type ValidateMiddleware<TCurrentInput extends AnyInput, M> =
  M extends MiddlewareFn<infer TReq, infer TAdd>
    ? CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M>
    : M extends IMiddleware<infer TReq, infer TAdd>
      ? CheckMiddlewareCompatibility<TCurrentInput, TReq, TAdd, M>
      : never;

/**
 * Извлекает TAddition из middleware
 */
type ExtractAddition<M> =
  M extends MiddlewareFn<any, infer TAdd>
    ? TAdd
    : M extends IMiddleware<any, infer TAdd>
      ? TAdd
      : never;

/**
 * Типизированный pipeline
 *
 * CIn  - входной тип контекста (всегда UnvalidatedContext<EmptyMeta> для нового pipeline)
 * COut - выходной тип контекста (ValidatedContext<I, M> или UnvalidatedContext<M>)
 *
 * Pipeline иммутабельный: каждый .use() возвращает новый экземпляр.
 * Это позволяет безопасно переиспользовать базовые pipeline'ы.
 */
export class Pipeline<TInput extends AnyInput> {
  /**
   * Приватный конструктор - создание только через static методы
   */
  private constructor(
    private readonly middlewares: ((
      ctx: any,
    ) => Promise<AnyAddition | undefined>)[] = [],
  ) {}

  /**
   * Создаёт пустой pipeline с пустым meta
   */
  static empty(): Pipeline<EmptyInput> {
    return new Pipeline([]);
  }

  use<M extends MiddlewareInstanceOrFunction<any, any>>(
    middleware: ValidateMiddleware<TInput, M>,
  ): Pipeline<TInput & ExtractAddition<M>> {
    return new Pipeline([
      ...this.middlewares,
      normalizeMiddleware(middleware as M),
    ]);
  }

  /**
   * Выполняет pipeline с handler
   *
   * @param handler - бизнес-логика endpoint (получает только input и meta)
   * @param ctx - начальный контекст от транспорта
   */
  async executeWithHandler<TOutput>(
    handler: (input: TInput) => OutputSync<TOutput> | Output<TOutput>,
    ctx: ExtendableContext<TInput>,
  ): Promise<ResponseContext<TOutput>> {
    try {
      let currentCtx: ExtendableContext<AnyInput> = ctx;

      // Выполняем цепочку middleware
      for (const middleware of this.middlewares) {
        const append = await middleware(currentCtx);

        currentCtx = {
          ...currentCtx,
          input: {
            ...currentCtx.input,
            ...append,
          },
        };
      }

      // Здесь мы верим, что благодаря сильной типизации Use - последняя middleware
      // действительно возвращает именно TInput.
      const result = await handler(currentCtx.input as TInput);
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
export function definePipeline(): Pipeline<EmptyInput> {
  return Pipeline.empty();
}
