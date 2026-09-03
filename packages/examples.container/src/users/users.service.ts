import { Logger } from '../logging';

import { UserRepository } from './users.repository';

import { Injectable, OnDestroy, OnInit } from '@nestling/container';

@Injectable([UserRepository, Logger('users')])
export class UserService {
  #repository: UserRepository;
  #logger: Logger;

  constructor(repository: UserRepository, logger: Logger) {
    this.#repository = repository;
    this.#logger = logger;
  }

  @OnInit()
  async initialize(): Promise<void> {
    this.#logger.log('UserService initialized');
  }

  @OnDestroy()
  async cleanup(): Promise<void> {
    this.#logger.log('UserService cleanup');
  }

  async getUsers(): Promise<string[]> {
    return await this.#repository.findAll();
  }
}
