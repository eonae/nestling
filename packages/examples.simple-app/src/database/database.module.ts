import { ConfigModule } from '../config';
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
  // Семейство в exports — контракт «модуль контрибьютит в HealthCheck»:
  // без него узел-агрегат не смог бы забрать вклад при strictExports.
  exports: [IDatabase, IHealthCheck],
  imports: [ConfigModule],
});
