import { ForgetUserImpl } from './forget-user.endpoint.js';
import { RegisterUserImpl } from './register-user.endpoint.js';
import { DbUsersRepository, UsersRepository$ } from './users.repository.js';

import { makeFeature } from '@nestlingjs/app';
import { classProvider } from '@nestlingjs/container';

/**
 * Фича `users`: принимает команды регистрации и удаления, спрашивает
 * соседа об адресе и публикует факт регистрации.
 *
 * Про транспорт, брокер и процессы здесь ничего нет. Фича знает только
 * операции соседей; где работают их владельцы, решает корень. Связь с
 * фичей `notifications` не объявляется полем: она выводится из операций,
 * которые вызывают хендлеры.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [classProvider(UsersRepository$, DbUsersRepository)],
  endpoints: [RegisterUserImpl, ForgetUserImpl],
});
