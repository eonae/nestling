/**
 * Фикстура: класс с методом `handle` объявлен `@Component`.
 *
 * Обратный случай к `component-extra-dependency`: страховка от `any`
 * не должна погасить сам запрет. Диагностика обязана называть `@Handler`.
 */

import { Component } from '@nestlingjs/container';

import { Database } from '../support/fixture-kit.js';

@Component([Database])
export class CreateUserHandler {
  constructor(private readonly db: Database) {}

  async handle(): Promise<string> {
    return this.db.query();
  }
}
