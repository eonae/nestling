import { AppConfig } from '../config/app.config';
import { IHealthCheck } from '../health';
import { IApiClient } from '../interfaces';
import { ILogger } from '../logging';

import { ApiHealthCheck } from './api.health';

import type { Config } from '@nestling/config';
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
      (config: Config<typeof AppConfig>, logger: ILogger): IApiClient => {
        logger.log(`Creating API client for ${config.databaseUrl}`);
        return {
          get: async (url: string) => {
            logger.log(`API call to ${url}`);
            return { data: 'mock response' };
          },
        };
      },
      // Ту же секцию читает и `module:database` — общий ключ не требует
      // ни владельца, ни согласования: право читать ≠ владение.
      [AppConfig, ILogger('api')] as const,
    ),
    // Второй вклад в то же семейство — из другого модуля, без правки первого.
    classProvider(IHealthCheck('api'), ApiHealthCheck),
  ],
  exports: [IApiClient, IHealthCheck],
});
