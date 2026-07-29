import { ConfigModule } from '../config';
import { IHealthCheck } from '../health';
import { IApiClient, IConfig } from '../interfaces';
import { ILogger } from '../logging';

import { ApiHealthCheck } from './api.health';

import {
  classProvider,
  factoryProvider,
  makeModule,
} from '@nestling/container';

export const ApiModule = makeModule({
  name: 'module:api',
  providers: [
    factoryProvider(
      IApiClient,
      (config: IConfig, logger: ILogger): IApiClient => {
        logger.log(`Creating API client for ${config.databaseUrl}`);
        return {
          get: async (url: string) => {
            logger.log(`API call to ${url}`);
            return { data: 'mock response' };
          },
        };
      },
      [IConfig, ILogger('api')] as const,
    ),
    // Второй вклад в то же семейство — из другого модуля, без правки первого.
    classProvider(IHealthCheck('api'), ApiHealthCheck),
  ],
  exports: [IApiClient, IHealthCheck],
  imports: [ConfigModule],
});
