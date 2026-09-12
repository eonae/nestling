/**
 * Фикстура: функция-хендлер реализации возвращает отказ вне `errors:`
 * операции.
 *
 * Проверка у этой формы стоит в возвращаемом типе, а не в слоте. Снапшот
 * фиксирует, что ошибка всё равно садится на строку `handler:` и называет
 * код отказа.
 */

import { httpEndpoint } from '@nestlingjs/transport.http';

import { CardDeclined, CreateUser as CreateUserOperation } from '../support/fixture-kit.js';

export const CreateUser = httpEndpoint.implement(CreateUserOperation, {
  handler: async () => CardDeclined(),
});
