import { AppConfig } from '../config/app.config.js';
import { HealthCheck } from '../health/index.js';
import type { ApiClient } from '../interfaces.js';
import { ApiClient$ } from '../interfaces.js';
import { Logger } from '../logging/index.js';

import { ApiHealthCheck } from './api.health.js';

import type { Config } from '@nestling/config';
import {
  classProvider,
  factoryProvider,
  makeModule,
} from '@nestling/container';

export const ApiModule = makeModule({
  name: 'module:api',
  providers: [
    // Фабрика получает зависимости позиционно, в порядке массива токенов
    factoryProvider(
      ApiClient$,
      (config: Config<typeof AppConfig>, logger: Logger): ApiClient => {
        logger.log(
          `Creating API client for ${new URL(config.databaseUrl).host}`,
        );
        return {
          get: async (url: string) => {
            logger.log(`API call to ${url}`);
            return { data: 'mock response' };
          },
        };
      },
      [AppConfig, Logger('api')] as const,
    ),
    classProvider(HealthCheck('api'), ApiHealthCheck),
  ],
});
