import { classProvider, makeModule, Module } from '../../framework';
import { ConfigModule } from '../config';
import { IDatabase } from '../di';
import { Database } from './database.service';

export const DatabaseModule = makeModule({
  name: 'module:database',
  providers: [classProvider(IDatabase, Database)],
  exports: [IDatabase],
  imports: [ConfigModule],
});
