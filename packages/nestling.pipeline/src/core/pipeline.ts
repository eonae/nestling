import type {
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
   * Нормализует ответ handler'а в ResponseContext
   * Поддерживает shorthand синтаксис: можно вернуть просто value
   */
  private normalizeResponse<T>(
    result: ResponseContext<T> | T,
  ): ResponseContext<T> {
    // Если уже ResponseContext - возвращаем как есть
    if (
      result &&
      typeof result === 'object' &&
      'value' in result &&
      !Array.isArray(result)
    ) {
      return result as ResponseContext<T>;
    }

    // Иначе оборачиваем в ResponseContext
    return {
      value: result as T,
    };
  }

  /**
   * Выполняет пайплайн: middleware → handler
   */
  async executeWithHandler(
    handler: HandlerFn,
    ctx: RequestContext,
  ): Promise<ResponseContext> {
    let index = 0;

    const next = async (): Promise<ResponseContext> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        return middleware(ctx, next);
      }

      // Все middleware выполнены, вызываем handler
      if (!handler) {
        throw new Error('Handler is not set');
      }

      // Вызываем handler с двумя параметрами: payload и metadata
      const result = await handler(ctx.payload as any, ctx.metadata as any);

      // Нормализуем ответ (поддержка shorthand синтаксиса)
      return this.normalizeResponse(result);
    };

    return next();
  }
}
