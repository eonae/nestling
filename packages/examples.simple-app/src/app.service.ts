import { ILogger } from './logging';

import { Injectable, OnInit } from '@nestling/container';

@Injectable([ILogger('app')])
export class AppService {
  constructor(private logger: ILogger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('AppService initialized with database and logger');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running with database and logging';
  }
}
