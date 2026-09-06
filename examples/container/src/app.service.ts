import type { Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Component } from '@nestling/container';

@Component([Logger$('app')])
export class AppService {
  constructor(private logger: Logger) {
    this.logger.info('AppService initialized');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running';
  }
}
