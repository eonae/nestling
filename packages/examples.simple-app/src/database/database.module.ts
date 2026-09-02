import { IHealthCheck } from '../health';
import { IDatabase } from '../interfaces';

import { DatabaseHealthCheck } from './database.health';
import { Database } from './database.service';

import { classProvider, makeModule } from '@nestling/container';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [
    classProvider(IDatabase, Database),
    // Вклад в семейство health-check'ов: обычный провайдер с членским токеном.
    classProvider(IHealthCheck('database'), DatabaseHealthCheck),
  ],
  // `dependsOn: [ConfigModule]` больше нет: секция конфига — не провайдер
  // модуля, а член семейства, который становится узлом графа через инжект.
});
