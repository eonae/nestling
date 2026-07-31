import type { User } from '../../common/types';

import { UsersStore } from './users.store';

import { Injectable, makeToken } from '@nestling/container';

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
 */
@Injectable(UsersRepository, [UsersStore])
export class StoredUsersRepository implements IUsersRepository {
  constructor(private readonly store: UsersStore) {}

  async all(): Promise<User[]> {
    return this.store.rows;
  }

  async byId(id: string): Promise<User | null> {
    return this.store.rows.find((user) => user.id === id) ?? null;
  }

  async byEmail(email: string): Promise<User | null> {
    return this.store.rows.find((user) => user.email === email) ?? null;
  }

  async insert(data: Omit<User, 'id'>): Promise<User> {
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
}
