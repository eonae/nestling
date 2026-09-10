import type { Logger } from '@nestlingjs/app';
import { Logger$ } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

@Component([Logger$('app')])
export class AppService {
  constructor(private logger: Logger) {
    this.logger.info('AppService initialized');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running';
  }
}
