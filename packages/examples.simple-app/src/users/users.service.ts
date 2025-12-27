import { ILogger } from '../logging';

import { UserRepository } from './users.repository';

import { Injectable, OnDestroy, OnInit } from '@nestling/container';

@Injectable([UserRepository, ILogger('users')])
export class UserService {
  #repository: UserRepository;
  #logger: ILogger;

  constructor(repository: UserRepository, logger: ILogger) {
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
