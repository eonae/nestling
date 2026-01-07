/* eslint-disable no-console */
import type {
  MiddlewareFn,
  RequestContext,
  ResponseContext,
} from '@nestling/pipeline';

export const RequestResponseLogging: MiddlewareFn = async (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>,
) => {
  console.log(`→ ${ctx.pattern}`);
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  console.log(`← ${ctx.pattern} - ${response.status} (${duration}ms)`);
  return response;
};
