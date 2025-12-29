/* eslint-disable no-console */
import type {
  MiddlewareFn,
  RequestContext,
  ResponseContext,
} from '@nestling/transport';

export const RequestResponseLogging: MiddlewareFn = async (
  ctx: RequestContext,
  next: () => Promise<ResponseContext>,
) => {
  console.log(`→ ${ctx.method} ${ctx.path}`);
  const start = Date.now();
  const response = await next();
  const duration = Date.now() - start;
  console.log(
    `← ${ctx.method} ${ctx.path} - ${response.status || 200} (${duration}ms)`,
  );
  return response;
};
