import { Module, OnDestroy, OnInit } from '../framework';
import { ApiModule } from './api';
import { AppService } from './app.service';
import { ILogger } from './di';
import { UserModule } from './users';

@Module({
  providers: [AppService],
  imports: [UserModule, ApiModule],
  deps: [ILogger]
})
export class AppModule {
  constructor(private readonly logger: ILogger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('AppModule initialized');
  }

  @OnDestroy()
  async cleanup(): Promise<void> {
    this.logger.log('AppModule destroyed');
  }
}
