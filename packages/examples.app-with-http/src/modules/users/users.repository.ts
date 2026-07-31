import type { User } from '../../common/types';
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import { UsersStore } from './users.store';

import { Injectable, makeToken } from '@nestling/container';
import type { CtxReader } from '@nestling/pipeline';
import { Ctx, RequestId } from '@nestling/pipeline';

/**
 * Порт хранилища пользователей.
 *
 * Тот самый архитектурный шов, на котором мокает app-тест: токен
 * экспортируется тестовой поверхностью пакета (`./testing`), а всё, что
 * ниже него — {@link UsersStore} с его соединением, — в тесте не нужно и
 * выпадает прунингом.
 */
export interface IUsersRepository {
  all(): Promise<User[]>;
  byId(id: string): Promise<User | null>;
  byEmail(email: string): Promise<User | null>;
  insert(data: Omit<User, 'id'>): Promise<User>;
  patch(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>;
  remove(id: string): Promise<boolean>;
}

export const UsersRepository = makeToken<IUsersRepository>('UsersRepository');

/**
 * Боевая реализация репозитория — поверх {@link UsersStore}.
 *
 * Витрина ambient-контекста: `requestId` сюда **не протаскивается**
 * параметром — ни через сигнатуры порта, ни через `meta` хендлера. Вместо
 * этого инжектируется ридер `Ctx(RequestId)`, то есть обычный узел графа:
 * зависимость видна в `explain()`, а в тесте подменяется `contextValue`.
 * Значение кладёт слой наблюдаемости (`withRequestId()`), и что он
 * композирован на каждой HTTP-ручке, гарантирует политика в `main.ts`.
 */
@Injectable(UsersRepository, [UsersStore, ILogger, Ctx(RequestId)])
export class StoredUsersRepository implements IUsersRepository {
  constructor(
    private readonly store: UsersStore,
    private readonly logger: ILoggerService,
    private readonly requestId: CtxReader<string>,
  ) {}

  async all(): Promise<User[]> {
    this.trace('all');

    return this.store.rows;
  }

  async byId(id: string): Promise<User | null> {
    this.trace(`byId ${id}`);

    return this.store.rows.find((user) => user.id === id) ?? null;
  }

  async byEmail(email: string): Promise<User | null> {
    return this.store.rows.find((user) => user.email === email) ?? null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
    this.trace(`insert ${data.email}`);

    const user: User = { id: this.store.nextId(), ...data };
    this.store.rows.push(user);

    return user;
  }

  async patch(
    id: string,
    data: Partial<Omit<User, 'id'>>,
  ): Promise<User | null> {
    const rows = this.store.rows;
    const index = rows.findIndex((user) => user.id === id);

    if (index === -1) {
      return null;
    }

    rows[index] = { ...rows[index], ...data };

    return rows[index];
  }

  async remove(id: string): Promise<boolean> {
    const rows = this.store.rows;
    const index = rows.findIndex((user) => user.id === id);

    if (index === -1) {
      return false;
    }

    rows.splice(index, 1);

    return true;
  }

  /**
   * Запись с корреляцией.
   *
   * Читается `peek()`, а не `get()`: тот же инстанс репозитория может быть
   * позван из `@OnInit` или фоновой задачи, где request-контекста нет вовсе,
   * и падать из-за строчки лога он не должен.
   */
  private trace(operation: string): void {
    this.logger.debug(`[${this.requestId.peek() ?? 'n/a'}] ${operation}`);
  }
}
