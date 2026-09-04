import { RateLimiter } from './rate-limiter.js';

import { makeModule } from '@nestling/container';

export const RuntimeModule = makeModule({
  name: 'module:runtime',
  providers: [RateLimiter],
});
