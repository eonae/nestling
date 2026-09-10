import { User } from './user.js';

import { makeEvent } from '@nestlingjs/operations';

/**
 * Пользователь создан.
 *
 * Событие, а не команда: подписчиков у факта ноль или больше, и ни один
 * из них не отвечает создателю. `durable: true` — факт не должен
 * теряться, пока подписчик недоступен.
 */
export const UserCreated = makeEvent({
  name: 'users.created',
  input: User.pick({ id: true, name: true, email: true }),
  durable: true,
  doc: {
    summary: 'Пользователь создан',
    description:
      'Публикуется после коммита транзакции, которая создала пользователя.',
    tags: ['users'],
  },
});
