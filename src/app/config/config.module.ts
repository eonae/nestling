import { valueProvider, Module, makeModule } from '../../framework';
import { IConfig } from '../di';

export const ConfigModule = makeModule({
  name: 'module:config',
  providers: [
    valueProvider(IConfig, {
      databaseUrl: 'postgresql://localhost:5432/myapp',
      logLevel: 'info'
    })
  ],
  exports: [IConfig],
});
