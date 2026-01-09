import { Injectable } from '@nestling/container';
import type { IMiddleware, RequestContext, ResponseContext } from '@nestling/pipeline';
import { Middleware } from '@nestling/pipeline';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';

/**
 * Middleware для измерения времени обработки запросов
 */
@Injectable([ILogger])
@Middleware()
export class TimingMiddleware implements IMiddleware {
  constructor(private logger: ILoggerService) {}

  async apply(
    ctx: RequestContext,
    next: () => Promise<ResponseContext>,
  ): Promise<ResponseContext> {
    const start = Date.now();
    this.logger.log(`[${ctx.transport}] ${ctx.pattern} - started`);

    const response = await next();

    const duration = Date.now() - start;
    this.logger.log(`[${ctx.transport}] ${ctx.pattern} - completed in ${duration}ms`);

    // Добавляем заголовок с временем ответа для HTTP
    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-Response-Time'] = `${duration}ms`;

    return response;
  }
}

