/* eslint-disable no-console */
import type {
  IMiddleware,
  RequestContext,
  ResponseContext,
} from '@nestling/pipeline';
import { Middleware } from '@nestling/pipeline';

/**
 * Middleware-класс для измерения времени выполнения команды
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

    console.log(`⏱️  ${duration}ms`);
    return response;
  }
}
