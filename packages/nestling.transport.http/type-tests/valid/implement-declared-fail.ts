/**
 * Фикстура: реализация операции возвращает только её отказы.
 *
 * Пайплайн объявляет тот же отказ, что и операция, поэтому слот
 * `pipeline` его принимает.
 */

import {
  CreateUser as CreateUserOperation,
  EmailTaken,
} from '../support/fixture-kit.js';

import { makePipeline, Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

const guarded = makePipeline().pre(() => EmailTaken(), {
  errors: [EmailTaken],
});

class CreateUserHandler {
  async handle(payload: { email: string }) {
    return new Ok({ id: 'u-1', email: payload.email });
  }
}

export const CreateUserByFunction = httpEndpoint.implement(
  CreateUserOperation,
  {
    pipeline: guarded,
    handler: async (payload) => new Ok({ id: 'u-1', email: payload.email }),
  },
);

export const CreateUserByClass = httpEndpoint.implement(CreateUserOperation, {
  pipeline: guarded,
  handler: CreateUserHandler,
});
