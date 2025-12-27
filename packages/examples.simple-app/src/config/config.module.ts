import { IConfig } from '../interfaces';

import { makeModule, valueProvider } from '@nestling/container';

export const ConfigModule = makeModule({
  name: 'module:config',
  providers: [
    valueProvider(IConfig, {
      databaseUrl: 'postgresql://localhost:5432/myapp',
      logLevel: 'info',
    }),
  ],
  exports: [IConfig],
});
