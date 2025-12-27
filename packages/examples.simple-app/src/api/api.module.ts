import { ConfigModule } from '../config';
import { IApiClient, IConfig } from '../interfaces';
import { ILogger } from '../logging';

import { factoryProvider, makeModule } from '@nestling/container';

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
  ],
  exports: [IApiClient],
  imports: [ConfigModule],
});
