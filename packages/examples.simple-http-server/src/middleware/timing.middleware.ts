/* eslint-disable no-console */

import type {
  IMiddleware,
  RequestContext,
  ResponseContext,
} from '@nestling/pipeline';
import { Middleware } from '@nestling/pipeline';

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

    // Добавляем timing в headers для HTTP transport
    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    console.log(`⏱️  ${duration}ms`);
    return response;
  }
}
