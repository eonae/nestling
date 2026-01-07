/* eslint-disable no-console */
import type {
  MiddlewareFn,
  RequestContext,
  ResponseContext,
} from '@nestling/pipeline';

/**
 * Middleware для логирования команд CLI
 */
export const LoggingMiddleware: MiddlewareFn = async (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>,
) => {
  console.log(`\n→ Executing command: ${ctx.pattern}`);
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  console.log(`← Command completed in ${duration}ms\n`);
  return response;
};
