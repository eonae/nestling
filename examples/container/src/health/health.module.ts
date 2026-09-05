import { HealthService } from './health.service.js';

import { makeModule } from '@nestling/container';

export const HealthModule = makeModule({
  name: 'module:health',
  providers: [HealthService],
});
