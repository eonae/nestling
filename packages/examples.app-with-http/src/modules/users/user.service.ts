import { Injectable } from '@nestling/container';
import type { User, ImportResult } from '../../common/types';
import { ADMIN_USER_ID } from '../../common/constants';
import type { ILoggerService } from '../logger/logger.service';
import { ILogger } from '../logger/logger.service';

/**
 * Сервис для работы с пользователями
 */
@Injectable([ILogger])
export class UserService {
  private users: User[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ];
  private nextId = 3;

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
      id: String(this.nextId++),
      ...data,
    };
    this.users.push(user);
    this.logger.log(`Created user ${user.id}`);
    return user;
  }

  async update(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null> {
    this.logger.log(`Updating user ${id}`);
    const userIndex = this.users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      return null;
    }

    this.users[userIndex] = {
      ...this.users[userIndex],
      ...data,
    };

    this.logger.log(`Updated user ${id}`);
    return this.users[userIndex];
  }

  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting user ${id}`);
    
    // Защита admin пользователя
    if (id === ADMIN_USER_ID) {
      return false;
    }

    const userIndex = this.users.findIndex((u) => u.id === id);
    if (userIndex === -1) {
      return false;
    }

    this.users.splice(userIndex, 1);
    this.logger.log(`Deleted user ${id}`);
    return true;
  }

  async search(query: string): Promise<User[]> {
    this.logger.log(`Searching users with query: ${query}`);
    const lowerQuery = query.toLowerCase();
    
    return this.users.filter(
      (user) =>
        user.name.toLowerCase().includes(lowerQuery) ||
        user.email.toLowerCase().includes(lowerQuery),
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    this.logger.log(`Finding user by email: ${email}`);
    return this.users.find((u) => u.email === email) || null;
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<User | null> {
    this.logger.log(`Updating avatar for user ${userId}`);
    return this.update(userId, { avatarUrl });
  }

  /**
   * Экспорт всех пользователей через AsyncIterableIterator
   */
  async *exportAll(): AsyncIterableIterator<User> {
    this.logger.log('Exporting all users');
    for (const user of this.users) {
      yield user;
    }
  }

  /**
   * Импорт пользователей из стрима
   */
  async importUsers(
    stream: AsyncIterableIterator<Partial<User>>,
  ): Promise<ImportResult> {
    this.logger.log('Importing users from stream');
    let imported = 0;
    let failed = 0;
    const errors: Array<{ line: number; error: string }> = [];
    let lineNumber = 0;

    for await (const userData of stream) {
      lineNumber++;
      
      try {
        // Валидация минимальных данных
        if (!userData.name || !userData.email) {
          failed++;
          errors.push({
            line: lineNumber,
            error: 'Missing required fields: name or email',
          });
          continue;
        }

        // Валидация формата email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
          failed++;
          errors.push({
            line: lineNumber,
            error: `Invalid email format: ${userData.email}`,
          });
          continue;
        }

        // Проверка на дубликат email
        const existing = await this.findByEmail(userData.email);
        if (existing) {
          failed++;
          errors.push({
            line: lineNumber,
            error: `Email ${userData.email} already exists`,
          });
          continue;
        }

        // Создаем пользователя
        await this.create({
          name: userData.name,
          email: userData.email,
          avatarUrl: userData.avatarUrl,
        });
        imported++;
      } catch (error) {
        failed++;
        errors.push({
          line: lineNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Import completed: ${imported} imported, ${failed} failed`);
    
    return {
      imported,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

