import { HealthCheck } from '../health/index.js';
import { Database$ } from '../interfaces.js';

import { DatabaseHealthCheck } from './database.health.js';
import { InMemoryDatabase } from './database.service.js';

import { classProvider, makeModule } from '@nestling/container';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    // Вклад в семейство: обычный провайдер с членским токеном
    classProvider(HealthCheck('database'), DatabaseHealthCheck),
  ],
});
