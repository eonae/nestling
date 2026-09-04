import type { CreateUserInput } from '../../../api/operations.js';
import { CreateUser as CreateUserOperation } from '../../../api/operations.js';
import type { QuotaExceeded } from '../../../operations.js';
import {
  ClaimQuota,
  SignupRecorded,
  UserRegistered,
} from '../../../operations.js';
import { authed } from '../../../plugins/auth/index.js';
import { ActivityHub } from '../activity.hub.js';
import type { User } from '../user.js';
import { EmailTaken } from '../users.errors.js';
import type { UsersRepository } from '../users.repository.js';
import { UsersRepository$ } from '../users.repository.js';

import { Ok } from '@nestling/operations';
import type { Output } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { deadlineIn } from '@nestling/ports';
import { httpEndpoint } from '@nestling/transport.http';

/**
 * Бюджет вызова фичи квот, в миллисекундах.
 *
 * У вызова через порт нет умолчания: неявный таймаут однажды оборвал бы
 * долгую, но корректную операцию. Бюджет задаёт вызывающий.
 */
const QUOTA_CALL_BUDGET_MS = 500;

export const createUserHandler =
  (
    users: UsersRepository,
    quotas: Port<typeof ClaimQuota>,
    registered: Emitter<typeof UserRegistered>,
    signup: Emitter<typeof SignupRecorded>,
    activity: ActivityHub,
  ) =>
  async (
    payload: CreateUserInput,
  ): Output<User, typeof EmailTaken | typeof QuotaExceeded> => {
    if (await users.byEmail(payload.email)) {
      return EmailTaken({ email: payload.email });
    }

    // `?dryRun=true`: только проверка, без записи
    if (payload.dryRun) {
      return { id: 'dry-run', name: payload.name, email: payload.email };
    }

    // Соседняя фича вызывается через порт: вызов асинхронный и возвращает
    // `Ok | Fail` даже в одном процессе. Отказ разбирает вызывающий.
    // `deadline` — момент, а не длительность: он не сдвигается на `await`
    const claimed = await quotas.call(
      { email: payload.email },
      { deadline: deadlineIn(QUOTA_CALL_BUDGET_MS) },
    );

    if (claimed.isFail) {
      // Отказ соседа объявлен в `errors:` операции и уходит клиенту как
      // есть. Исчерпанный бюджет приходит кодом ядра `timeout`,
      // объявлять его не нужно
      return claimed as ReturnType<typeof QuotaExceeded>;
    }

    const user = await users.insert({
      name: payload.name,
      email: payload.email,
    });

    // Событие: `emit` завершается по факту доставки, отказ подписчика
    // сюда не приходит
    await registered.emit({ id: user.id, email: user.email });

    // Команда: ключ идемпотентности задаёт вызывающий, чтобы повтор после
    // сбоя нёс тот же ключ. Без ключа порт сгенерировал бы новый
    await signup.emit(
      { userId: user.id, email: user.email },
      { idempotencyKey: user.id },
    );

    // Лента активности: `publish` не ждёт ни одного подписчика
    activity.publish('created', user.id);

    // Статус 201 и заголовок задаются на успешном ответе
    return Ok.created(user, { Location: `/users/${user.id}` });
  };

/**
 * Адрес, схемы, bind-карта и `errors:` живут в операции `api/operations.ts`.
 * Вызыватели соседней фичи перечислены в `deps` как обычные зависимости.
 */
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: authed,
  handler: {
    deps: [
      UsersRepository$,
      ClaimQuota.caller,
      UserRegistered.emitter,
      SignupRecorded.emitter,
      ActivityHub,
    ],
    handle: createUserHandler,
  },
});
