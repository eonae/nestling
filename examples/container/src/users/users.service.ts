import type { Counter } from '../counters/index.js';
import { Counter$ } from '../counters/index.js';

import { UserRepository } from './users.repository.js';

import type { Logger } from '@nestlingjs/app';
import { Logger$ } from '@nestlingjs/app';
import { Component, OnStart } from '@nestlingjs/container';

@Component([UserRepository, Counter$('users'), Logger$('users')])
export class UserService {
  #repository: UserRepository;
  #calls: Counter;
  #logger: Logger;

  constructor(repository: UserRepository, calls: Counter, logger: Logger) {
    this.#repository = repository;
    this.#calls = calls;
    this.#logger = logger;
    this.#logger.info('UserService initialized');
  }

  /**
   * Пишет итог использования при остановке.
   *
   * Хук ничего не захватывает: он лишь подписывается на сигнал остановки,
   * тот же, что получают транспорты, — и читает его на SHUTDOWN.
   */
  @OnStart()
  watchShutdown(signal: AbortSignal): void {
    signal.addEventListener('abort', () => {
      this.#logger.info('UserService cleanup', { calls: this.#calls.value });
    });
  }

  async getUsers(): Promise<string[]> {
    this.#calls.increment();

    return await this.#repository.findAll();
  }
}
