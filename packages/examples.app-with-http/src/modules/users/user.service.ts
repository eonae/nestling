import { ADMIN_USER_ID } from '../../common/constants';
import type { ImportResult, User } from '../../common/types';
import type { ILoggerService } from '../logger';
import { ILogger } from '../logger';

import type { IUsersRepository } from './users.repository';
import { UsersRepository } from './users.repository';

import { Injectable } from '@nestling/container';

/**
 * Сервис для работы с пользователями.
 *
 * Хранилище — за портом {@link UsersRepository}: это и архитектурный шов
 * (сервис не знает, чем хранят), и шов тестовый — app-тест подменяет
 * именно его, а не сервис целиком.
 */
@Injectable([ILogger, UsersRepository])
export class UserService {
  constructor(
    private logger: ILoggerService,
    private repository: IUsersRepository,
  ) {
    this.logger.log('UserService initialized');
  }

  async getById(id: string): Promise<User | null> {
    this.logger.log(`Getting user ${id}`);
    return this.repository.byId(id);
  }

  async getAll(): Promise<User[]> {
    this.logger.log('Getting all users');
    return this.repository.all();
  }

  async create(data: Omit<User, 'id'>): Promise<User> {
    const user = await this.repository.insert(data);
    this.logger.log(`Created user ${user.id}`);
    return user;
  }

  async update(
    id: string,
    data: Partial<Omit<User, 'id'>>,
  ): Promise<User | null> {
    this.logger.log(`Updating user ${id}`);

    const updated = await this.repository.patch(id, data);
    if (updated) {
      this.logger.log(`Updated user ${id}`);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting user ${id}`);

    // Защита admin пользователя
    if (id === ADMIN_USER_ID) {
      return false;
    }

    const deleted = await this.repository.remove(id);
    if (deleted) {
      this.logger.log(`Deleted user ${id}`);
    }

    return deleted;
  }

  async search(query: string): Promise<User[]> {
    this.logger.log(`Searching users with query: ${query}`);
    const lowerQuery = query.toLowerCase();
    const users = await this.repository.all();

    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(lowerQuery) ||
        user.email.toLowerCase().includes(lowerQuery),
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    this.logger.log(`Finding user by email: ${email}`);
    return this.repository.byEmail(email);
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
    for (const user of await this.repository.all()) {
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
    const errors: { line: number; error: string }[] = [];
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
