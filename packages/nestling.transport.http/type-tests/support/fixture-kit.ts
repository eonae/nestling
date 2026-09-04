/**
 * Общий инвентарь фикстур: схемы, отказы и операция.
 *
 * Живёт вне `fixtures/`, потому что обязан компилироваться чисто —
 * диагностики отсюда в снапшоты не попадают. Устроен так же, как
 * `packages/nestling.pipeline/type-tests/support/fixture-kit.ts`.
 */

import { makeFail, makeRequest } from '@nestling/operations';
import { z } from 'zod';

export const UserInput = z.object({ id: z.string() });

export const User = z.object({ id: z.string(), email: z.string() });

export const CardDeclined = makeFail('payment_required:card_declined', {
  message: 'Card declined',
});

export const EmailTaken = makeFail('conflict:email_taken', {
  message: 'Email already taken',
});

export const Unauthorized = makeFail('unauthorized', { message: 'No token' });

/** Операция с HTTP-адресом: вход формы с `operation:` */
export const CreateUser = makeRequest({
  name: 'type-tests.users.create',
  http: 'POST /users',
  input: z.object({ email: z.string() }),
  output: User,
  errors: [EmailTaken],
});
