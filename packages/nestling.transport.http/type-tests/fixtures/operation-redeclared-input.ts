/**
 * Фикстура: форма с `operation:` переобъявляет интерфейс операции.
 *
 * `input` в этой форме объявлен как `never`, поэтому словарь не подходит
 * ни под одну перегрузку. Снапшот фиксирует текст, который автор увидит
 * в этом месте: TypeScript печатает ошибку последней перегрузки, и поле
 * `input` в ней не названо. Диф снапшота покажет, когда текст станет
 * точнее.
 */

import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

import { CreateUser as CreateUserOperation } from '../support/fixture-kit.js';

import { z } from 'zod';

class CreateUserHandler {
  async handle(payload: { email: string }) {
    return new Ok({ id: 'u-1', email: payload.email });
  }
}

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  input: z.object({ email: z.string() }),
  handler: CreateUserHandler,
});
