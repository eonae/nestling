import { AppConfig } from '../../app.config.js';

import type { User } from './user.js';

import type { Config, Logger } from '@nestling/app';
import { Logger$ } from '@nestling/app';
import { Injectable, OnDestroy, OnInit } from '@nestling/container';

/**
 * Соединение с базой. В примере это таблица в памяти.
 *
 * Соединение открывается в `@OnInit`, а не в конструкторе, и закрывается
 * в `@OnDestroy`. До `@OnInit` обращение к таблице бросает ошибку.
 */
@Injectable([AppConfig, Logger$.auto])
export class Database {
  #users: User[] | undefined;

  constructor(
    private readonly config: Config<typeof AppConfig>,
    private readonly logger: Logger,
  ) {}

  @OnInit()
  connect(): void {
    // В лог уходит только хост: значение поля секретное
    this.logger.info('database connected', {
      host: new URL(this.config.databaseUrl).host,
    });
    this.#users = [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ];
  }

  @OnDestroy()
  disconnect(): void {
    this.#users = undefined;
    this.logger.info('database disconnected');
  }

  /** Таблица пользователей */
  get users(): User[] {
    if (!this.#users) {
      throw new Error('Database is not connected: @OnInit has not run yet');
    }

    return this.#users;
  }
}
