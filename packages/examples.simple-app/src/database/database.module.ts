import { ConfigModule } from '../config';
import { IDatabase } from '../interfaces';

import { Database } from './database.service';

import { classProvider, makeModule } from '@nestling/container';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [classProvider(IDatabase, Database)],
  exports: [IDatabase],
  imports: [ConfigModule],
});
