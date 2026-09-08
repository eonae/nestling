import { AppConfig } from '../config/app.config.js';
import type { ApiClient } from '../interfaces.js';
import { ApiClient$ } from '../interfaces.js';

import { ApiHealthCheck } from './api.health.js';

import type { Config, Logger } from '@nestling/app';
import { HealthCheck$, Logger$ } from '@nestling/app';
import {
  classProvider,
  factoryProvider,
  makeModule,
} from '@nestling/container';

export const ApiModule = makeModule({
  name: 'module:api',
  providers: [
    // Фабрика получает зависимости позиционно, в порядке массива DI-токенов
    factoryProvider(
      ApiClient$,
      (config: Config<typeof AppConfig>, logger: Logger): ApiClient => {
        logger.info('Creating API client', {
          host: new URL(config.databaseUrl).host,
        });
        return {
          get: async (url: string) => {
            logger.info('API call', { url });
            return { data: 'mock response' };
          },
        };
      },
      [AppConfig, Logger$('api')] as const,
    ),
    classProvider(HealthCheck$('api'), ApiHealthCheck),
  ],
});
