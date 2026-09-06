import { makeFail } from '@nestling/operations';

/** Отказ проверки Bearer-токена. Его возвращает pre-юнит слоя `authed`. */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
