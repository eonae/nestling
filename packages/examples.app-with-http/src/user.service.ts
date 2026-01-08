import { Injectable } from '@nestling/container';
import type { ILoggerService } from './logger.service';
import { ILogger } from './logger.service';

/**
 * Интерфейс пользователя
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

/**
 * Сервис для работы с пользователями
 */
@Injectable([ILogger])
export class UserService {
  private users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];

  constructor(private logger: ILoggerService) {
    this.logger.log('UserService initialized');
  }

  async getById(id: string): Promise<User | null> {
    this.logger.log(`Getting user ${id}`);
    const user = this.users.find((u) => u.id === id) || null;
    return user;
  }

  async getAll(): Promise<User[]> {
    this.logger.log('Getting all users');
    return this.users;
  }

  async create(data: Omit<User, 'id'>): Promise<User> {
    const user: User = {
      id: String(this.users.length + 1),
      ...data,
    };
    this.users.push(user);
    this.logger.log(`Created user ${user.id}`);
    return user;
  }
}

