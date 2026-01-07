import type { OutputSync } from './result';
import { Fail, Ok } from './result';
import type {
  ErrorDetails,
  HandlerFn,
  IMiddleware,
  MiddlewareFn,
  RequestContext,
  ResponseContext,
} from './types';
import { isClass } from './types';

import type { Constructor } from '@common/misc';
/**
 * Класс для выполнения пайплайна middleware и handler
 */
export class Pipeline {
  private readonly middlewares: MiddlewareFn[] = [];

  /**
   * Добавляет middleware в пайплайн
   * Поддерживает как функции, так и классы
   */
  use(middleware: MiddlewareFn | Constructor<IMiddleware>): void {
    if (isClass(middleware)) {
      const instance = new middleware();
      this.middlewares.push((ctx, next) => instance.apply(ctx, next));
    } else {
      // MiddlewareFn (функция)
      this.middlewares.push(middleware);
    }
  }

  /**
   * Нормализует результат handler'а в ResponseContext
   * Поддерживает: Ok, примитивы/объекты (автоматически -> Success.ok)
   * Ошибки обрабатываются через throw Fail в errorToResponse()
   */
  private normalizeResponse<T>(result: OutputSync<T>): ResponseContext<T> {
    // Если это Ok - преобразуем в SuccessResponseContext
    if (result instanceof Ok) {
      return {
        status: result.status,
        value: result.value,
        headers: result.headers,
      };
    }

    // Иначе оборачиваем в Success.ok и преобразуем
    return {
      status: 'OK',
      value: result as T,
    };
  }

  /**
   * Преобразует ошибку в ErrorResponseContext
   */
  private errorToResponse(error: unknown): ResponseContext {
    if (error instanceof Fail) {
      // Если это Failure - используем его статус и данные
      const errorValue: ErrorDetails = {
        error: error.message,
      };
      if (error.details) {
        errorValue.details = error.details;
      }
      return {
        status: error.status,
        value: errorValue,
      };
    }

    // Для обычных ошибок - INTERNAL_ERROR
    // TODO: Переместить в конфигурацию
    const isDevelopment = true; // временная константа

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
      status: 'INTERNAL_ERROR',
      value: errorValue,
    };
  }

  /**
   * Выполняет пайплайн: middleware → handler
   * Глобально перехватывает все ошибки
   */
  async executeWithHandler(
    handler: HandlerFn,
    ctx: RequestContext,
  ): Promise<ResponseContext> {
    try {
      let index = 0;

      const next = async (): Promise<ResponseContext> => {
        if (index < this.middlewares.length) {
          const middleware = this.middlewares[index++];
          return middleware(ctx, next);
        }

        if (!handler) {
          throw new Error('Handler is not set');
        }

        const result = await handler(ctx.payload as any, ctx.metadata as any);
        return this.normalizeResponse(result);
      };

      return await next();
    } catch (error) {
      // Глобальный перехват всех ошибок (из middleware или handler)
      return this.errorToResponse(error);
    }
  }
}
