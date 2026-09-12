/**
 * Фикстура: реализация операции переобъявляет её интерфейс.
 *
 * Поля `input` в словаре реализации нет, поэтому словарь не подходит ни
 * под одну перегрузку. Снапшот фиксирует текст, который автор увидит в
 * этом месте.
 */

import { Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

import { CreateUser as CreateUserOperation } from '../support/fixture-kit.js';

import { z } from 'zod';

class CreateUserHandler {
  async handle(payload: { email: string }) {
    return new Ok({ id: 'u-1', email: payload.email });
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  input: z.object({ email: z.string() }),
  handler: CreateUserHandler,
});
