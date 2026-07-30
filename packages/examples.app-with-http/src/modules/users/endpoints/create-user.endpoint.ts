import { basePipeline } from '../../../common/pipelines';
import type { ILoggerService } from '../../logger/logger.service';
import { ILogger } from '../../logger/logger.service';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Fail, Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
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

    const user = await users.create(payload);

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  };

/**
 * Endpoint для создания пользователя
 */
export const CreateUser = httpEndpoint({
  method: 'POST',
  path: '/api/users',
  input: CreateUserInput,
  output: CreateUserOutput,
  pipeline: basePipeline,
  deps: [UserService, ILogger],
  handle: createUserHandler,
});
