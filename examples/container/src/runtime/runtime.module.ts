import { RateLimiter } from './rate-limiter.js';

import { makeModule } from '@nestlingjs/container';

export const RuntimeModule = makeModule({
  name: 'module:runtime',
  providers: [RateLimiter],
});
