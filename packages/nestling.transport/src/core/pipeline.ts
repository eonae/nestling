import type {
  Constructor,
  HandlerFn,
  IMiddleware,
  MiddlewareFn,
  RequestContext,
  ResponseContext,
} from './types';
import { isClass } from './types';
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
      // payload и metadata будут undefined если схемы не были переданы
      return handler(ctx.payload as any, ctx.metadata as any);
    };

    return next();
  }
}
