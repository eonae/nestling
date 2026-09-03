import { HealthCheck } from '../health';
import { Database$ } from '../interfaces';

import { DatabaseHealthCheck } from './database.health';
import { InMemoryDatabase } from './database.service';

import { classProvider, makeModule } from '@nestling/container';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    // Вклад в семейство: обычный провайдер с членским токеном
    classProvider(HealthCheck('database'), DatabaseHealthCheck),
  ],
});
