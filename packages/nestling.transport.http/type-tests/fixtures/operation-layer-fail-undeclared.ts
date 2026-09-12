/**
 * Фикстура: слой объявляет отказ, которого нет в `errors:` операции.
 *
 * Слот `pipeline` реализации принимает литерал `__error`, поэтому
 * декларация не компилируется. Снапшот фиксирует текст, который автор
 * увидит в этом месте.
 */

import { makePipeline, Ok } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

import {
  CreateUser as CreateUserOperation,
  Unauthorized,
} from '../support/fixture-kit.js';

const authed = makePipeline().pre(() => Unauthorized(), {
  errors: [Unauthorized],
});

class CreateUserHandler {
  async handle(payload: { email: string }) {
    return new Ok({ id: 'u-1', email: payload.email });
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  pipeline: authed,
  handler: CreateUserHandler,
});
