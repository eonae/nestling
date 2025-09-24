import { Module, OnInit } from '../../framework';
import { DatabaseModule } from '../database';
import { ILogger } from '../di';
import { UserRepository } from './users.repository';
import { UserService } from './users.service';

@Module({
  providers: [
    UserRepository,
    UserService,
  ],
  exports: [UserService],
  imports: [DatabaseModule],
  deps: [ILogger]
})
export class UserModule {
  constructor(private readonly logger: ILogger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('UserModule initialized');
  }
}