import { makeFail } from '@nestling/operations';

/**
 * Отказ проверки токена. Его бросает pre-юнит слоя `authed`.
 *
 * Код из одной категории: уточнять нечего.
 */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
