import type { Counter } from '../counters/index.js';
import { Counter$ } from '../counters/index.js';

import { UserRepository } from './users.repository.js';

import type { Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Injectable, OnDestroy, OnInit } from '@nestling/container';

@Injectable([UserRepository, Counter$('users'), Logger$('users')])
export class UserService {
  #repository: UserRepository;
  #calls: Counter;
  #logger: Logger;

  constructor(repository: UserRepository, calls: Counter, logger: Logger) {
    this.#repository = repository;
    this.#calls = calls;
    this.#logger = logger;
  }

  @OnInit()
  async initialize(): Promise<void> {
    this.#logger.info('UserService initialized');
  }

  @OnDestroy()
  async cleanup(): Promise<void> {
    this.#logger.info('UserService cleanup', { calls: this.#calls.value });
  }

  async getUsers(): Promise<string[]> {
    this.#calls.increment();

    return await this.#repository.findAll();
  }
}
