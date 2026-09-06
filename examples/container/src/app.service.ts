import type { Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Injectable, OnInit } from '@nestling/container';

@Injectable([Logger$('app')])
export class AppService {
  constructor(private logger: Logger) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.info('AppService initialized');
  }

  async getAppInfo(): Promise<string> {
    return 'App is running';
  }
}
