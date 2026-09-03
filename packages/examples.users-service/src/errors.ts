import { defineFail } from '@nestling/operations';

/** Отказ проверки токена. Его бросает pre-юнит слоя `authed`. */
export const Unauthorized = defineFail('UNAUTHORIZED', {
  status: 'UNAUTHORIZED',
  message: 'Bearer token is missing or invalid',
});
