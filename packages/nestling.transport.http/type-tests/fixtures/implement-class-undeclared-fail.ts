/**
 * Фикстура: класс-хендлер реализации возвращает отказ вне `errors:`
 * операции.
 *
 * Снапшот фиксирует главное требование change'а: диагностика садится на
 * строку `handler:` и называет код отказа.
 */

import { httpEndpoint } from '@nestlingjs/transport.http';

import { CardDeclined, CreateUser as CreateUserOperation } from '../support/fixture-kit.js';

class CreateUserHandler {
  async handle() {
    return CardDeclined();
  }
}

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  handler: CreateUserHandler,
});
