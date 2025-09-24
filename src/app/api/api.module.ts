import { factoryProvider, Module, OnInit } from '../../framework';
import { ConfigModule } from '../config';
import { IApiClient, IConfig, ILogger } from '../di';

@Module({
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
  deps: [ILogger],
})
export class ApiModule {
  constructor(private readonly logger: ILogger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('ApiModule initialized');
  }
}