import type {
  HandlerFn,
  RequestContext,
  ResponseContext,
} from './interfaces.js';

/**
 * Middleware для обработки запроса
 */
export type Middleware = (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>,
) => Promise<ResponseContext>;

/**
 * Класс для выполнения пайплайна middleware и handler
 */
export class Pipeline {
  private readonly middlewares: Middleware[] = [];
  private handler?: HandlerFn;

  /**
   * Добавляет middleware в пайплайн
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Устанавливает финальный handler
   */
  setHandler(handler: HandlerFn): void {
    this.handler = handler;
  }

  /**
   * Выполняет пайплайн: middleware → handler
   */
  async execute(ctx: RequestContext): Promise<ResponseContext> {
    if (!this.handler) {
      throw new Error('Handler is not set');
    }

    let index = 0;

    const handler = this.handler;

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
