import { valueProvider, OnInit, Module } from '../../framework';
import { IConfig, ILogger } from '../di';


@Module({
  providers: [
    valueProvider(IConfig, {
      databaseUrl: 'postgresql://localhost:5432/myapp',
      logLevel: 'info'
    })
  ],
  exports: [IConfig],
  deps: [ILogger]
})
export class ConfigModule {
  readonly #logger: ILogger;

  constructor(logger: ILogger) {
    this.#logger = logger;
  }

  @OnInit()
  async initialize(): Promise<void> {
    this.#logger.log('ConfigModule initialized');
  }
}
