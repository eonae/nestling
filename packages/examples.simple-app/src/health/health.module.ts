import { HealthService } from './health.service';

import { makeModule } from '@nestling/container';

export const HealthModule = makeModule({
  name: 'module:health',
  providers: [HealthService],
  exports: [HealthService],
});
