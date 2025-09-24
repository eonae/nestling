import { classProvider, Module, OnInit } from '../../framework';
import { ConfigModule } from '../config';
import { IConfig, IDatabase, ILogger } from '../di';
import { Database } from './database.service';

@Module({
  providers: [classProvider(IDatabase, Database)],
  exports: [IDatabase],
  imports: [ConfigModule],
  deps: [IConfig, ILogger],
})
export class DatabaseModule {
  readonly #config: IConfig;
  readonly #logger: ILogger;

  constructor(config: IConfig, logger: ILogger) {
    this.#config = config;
    this.#logger = logger;
  }

  @OnInit()
  async initialize(): Promise<void> {
    this.#logger.log('DatabaseModule initialized with config:', this.#config.databaseUrl);
  }
}