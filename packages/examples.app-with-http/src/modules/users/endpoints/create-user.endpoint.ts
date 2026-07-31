import { basePipeline } from '../../../common/pipelines';
import {
  ClaimQuota,
  QuotaExceeded as QuotaExceededDefinition,
  UserRegistered,
} from '../../../contracts';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { ActivityHub } from '../activity.hub';
import { EmailTaken } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
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
  (
    users: UserService,
    logger: ILoggerService,
    quotas: Port<typeof ClaimQuota>,
    registered: Emitter<typeof UserRegistered>,
    activity?: ActivityHub,
  ) =>
  async (
    payload: CreateUserInput,
  ): Output<
    CreateUserOutput,
    ReturnType<typeof EmailTaken> | ReturnType<typeof QuotaExceededDefinition>
  > => {
    logger.log(`Handling POST /api/users - creating user ${payload.name}`);

    // Проверка на дубликат email
    const existing = await users.findByEmail(payload.email);
    if (existing) {
      // CONFLICT, а не BAD_REQUEST: словарь статусов теперь это выражает
      return EmailTaken({ email: payload.email });
    }

    // `?dryRun=true` — только проверка, без записи
    if (payload.dryRun) {
      return new Ok({
        id: 'dry-run',
        name: payload.name,
        email: payload.email,
      });
    }

    // Соседняя фича зовётся портом: всегда async, всегда `Ok | Fail`, даже
    // co-located. Разбирать отказ обязан вызывающий — и это ровно та
    // дисциплина, из-за которой переезд `quotas` в другой процесс не
    // потребует править ни строчки здесь
    const claimed = await quotas.call({ email: payload.email });
    if (claimed.isFail) {
      return claimed as ReturnType<typeof QuotaExceededDefinition>;
    }

    logger.log(`quota claimed, ${claimed.value.remaining} place(s) left`);

    const user = await users.create(payload);

    // Событие — fire-and-forget: `emit` резолвится по факту доставки, а не
    // обработки, и отказ подписчика сюда не всплывает
    await registered.emit({ id: user.id, email: user.email });

    // Публикация в ленту: `push` не ждёт подписчиков, поэтому создание
    // пользователя не замедляется ни на одного SSE-клиента
    activity?.publish('created', user.id);

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
  // Отказ соседней фичи объявляется здесь наравне со своими: ре-гидрация
  // по коду делает его настоящим `Fail`, и множество ответов ручки
  // остаётся закрытым
  errors: [EmailTaken, QuotaExceededDefinition],
  bind: { dryRun: query() },
  pipeline: basePipeline,
  deps: [
    UserService,
    ILogger,
    // Вызыватели инжектятся как обычные зависимости: узел появляется
    // только потому, что его здесь упомянули
    ClaimQuota.port,
    UserRegistered.emitter,
    ActivityHub,
  ],
  handle: createUserHandler,
});
