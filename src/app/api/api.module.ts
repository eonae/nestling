import { factoryProvider, makeModule, Module } from '../../framework';
import { ConfigModule } from '../config';
import { IApiClient, IConfig, ILogger } from '../di';

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
          }
        };
      },
      [IConfig, ILogger] as const
    )
  ],
  exports: [IApiClient],
  imports: [ConfigModule],
});
