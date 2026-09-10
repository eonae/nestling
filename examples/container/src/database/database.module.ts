import { Database$ } from '../interfaces.js';

import { DatabaseHealthCheck } from './database.health.js';
import { InMemoryDatabase } from './database.service.js';

import { HealthCheck$ } from '@nestlingjs/app';
import { classProvider, makeModule } from '@nestlingjs/container';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(Database$, InMemoryDatabase),
    // Вклад в пробы: обычный провайдер с членским DI-токеном ядра.
    // Ничего кроме этой строки объявлять не нужно
    classProvider(HealthCheck$('database'), DatabaseHealthCheck),
  ],
});
