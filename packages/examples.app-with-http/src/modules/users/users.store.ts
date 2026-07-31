import type { User } from '../../common/types';
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { Injectable, OnDestroy, OnInit } from '@nestling/container';

/**
 * Хранилище пользователей — стенд-ин внешнего ресурса (пула соединений).
 *
 * Ресурс захватывается в `@OnInit`, а не в конструкторе: так предписывает
 * фазовая модель, и на этом же держится `.check()` — структурная проверка
 * гоняет конструкторы, но не хуки.
 *
 * В app-тесте узел выпадает прунингом, если репозиторий подменён фейком:
 * его единственный потребитель — {@link StoredUsersRepository}.
 */
@Injectable([ILogger])
export class UsersStore {
  #connected = false;

  #rows: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];

  #nextId = 3;

  constructor(private readonly logger: ILoggerService) {}

  @OnInit()
  connect(): void {
    this.#connected = true;
    this.logger.log('UsersStore connected');
  }

  @OnDestroy()
  disconnect(): void {
    this.#connected = false;
    this.logger.log('UsersStore disconnected');
  }

  /** Строки таблицы; до `@OnInit` соединения нет — и это видно */
  get rows(): User[] {
    if (!this.#connected) {
      throw new Error('UsersStore is not connected: @OnInit has not run yet');
    }

    return this.#rows;
  }

  /** Следующий идентификатор — обязанность хранилища, а не сервиса */
  nextId(): string {
    return String(this.#nextId++);
  }
}
