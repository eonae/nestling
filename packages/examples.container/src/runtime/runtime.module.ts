import { RateLimiter } from './rate-limiter';

import { makeModule } from '@nestling/container';

export const RuntimeModule = makeModule({
  name: 'module:runtime',
  providers: [RateLimiter],
});
