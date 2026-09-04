import { Logger } from './logging/index.js';

import { Injectable, OnInit } from '@nestling/container';

@Injectable([Logger('app')])
export class AppService {
  constructor(private logger: Logger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('AppService initialized');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running';
  }
}
