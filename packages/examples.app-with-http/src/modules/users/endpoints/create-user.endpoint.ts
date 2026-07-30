import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { httpEndpoint, query } from '@nestling/transport.http';
import { z } from 'zod';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),

  // Поле-флаг: по канону POST оно уехало бы в тело, пометка `query()`
  // ниже переносит его в query-строку. Коерсия провод-строки — забота
  // автора схемы: `z.stringbool()` понимает 'true'/'false'/'1'/'0'.
  dryRun: z.stringbool().optional(),
});

const CreateUserOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

type CreateUserInput = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof CreateUserOutput>;

/**
 * Каррированная фабрика: внешний вызов — один раз на гашении зависимостей,
 * замыкание играет роль инстанса. Тестируется без фреймворка — вызовом с
 * фейками, без контейнера и транспорта.
 */
export const createUserHandler =
  (users: UserService, logger: ILoggerService) =>
  async (payload: CreateUserInput): Output<CreateUserOutput> => {
    logger.log(`Handling POST /api/users - creating user ${payload.name}`);

    // Проверка на дубликат email
    const existing = await users.findByEmail(payload.email);
    if (existing) {
      throw Fail.badRequest('Email already taken', { field: 'email' });
    }

    // `?dryRun=true` — только проверка, без записи
    if (payload.dryRun) {
      return new Ok({
        id: 'dry-run',
        name: payload.name,
        email: payload.email,
      });
    }

    const user = await users.create(payload);

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  };

/**
 * Endpoint для создания пользователя.
 *
 * Демонстрирует пометку размещения: `name`/`email` едут по канону POST в
 * теле, а `dryRun` вытянут пометкой в query-строку
 * (`POST /api/users?dryRun=true`). Присланный не в своё место `dryRun`
 * (в теле) в payload не попадёт — strict-приём.
 */
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  bind: { dryRun: query() },
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: createUserHandler,
});
