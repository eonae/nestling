import { Injectable, OnDestroy, OnInit } from '../../framework';
import { ILogger } from '../di';
import { UserRepository } from './users.repository';


@Injectable([UserRepository, ILogger])
export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: ILogger
  ) {}

  @OnInit()
  async initialize(): Promise<void> {
    this.logger.log('UserService initialized');
  }

  @OnDestroy()
  async cleanup(): Promise<void> {
    this.logger.log('UserService cleanup');
  }

  async getUsers(): Promise<string[]> {
    return await this.repository.findAll();
  }
}