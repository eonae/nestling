/**
 * Фикстура: слой объявляет отказ, которого нет в `errors:` операции.
 *
 * Слот `pipeline` в форме с `operation:` принимает литерал `__error`,
 * поэтому декларация не компилируется. Снапшот фиксирует текст, который
 * автор увидит в этом месте: TypeScript печатает ошибку последней
 * перегрузки — анонимной формы, — и до литерала с `hint` не доходит.
 * Незадекларированный код в тексте назван (`Fail<"unauthorized">` против
 * `never` в слоте `pipeline`), а полный текст с подсказкой даёт ошибка
 * при создании декларации. Диф снапшота покажет, когда текст станет
 * точнее.
 */

import { makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';

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

export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: CreateUserHandler,
});
