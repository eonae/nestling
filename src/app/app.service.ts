import { Injectable, OnInit } from '../framework';
import { ILogger } from './di';

@Injectable([ILogger])
export class AppService {
  constructor(
    private logger: ILogger,
  ) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('AppService initialized with database and logger');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running with database and logging';
  }
}
