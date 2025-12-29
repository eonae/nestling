import type {
  IMiddleware,
  RequestContext,
  ResponseContext,
} from '@nestling/transport';
import { Middleware } from '@nestling/transport';

/**
 * Middleware-класс для измерения времени выполнения запроса
 */
@Middleware()
export class TimingMiddleware implements IMiddleware {
  async apply(
    _: RequestContext,
    next: () => Promise<ResponseContext>,
  ): Promise<ResponseContext> {
    const start = Date.now();
    const response = await next();
    const duration = Date.now() - start;
    response.meta = {
      ...response.meta,
      timing: duration,
    };
    return response;
  }
}
