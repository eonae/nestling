import type { CreateUserInput, User } from '../../../api.operations';
import { CreateUser as CreateUserOperation } from '../../../api.operations';
import { QUOTA_CALL_BUDGET_MS } from '../../../common/constants';
import { basePipeline } from '../../../common/pipelines';
import type { QuotaExceeded as QuotaExceededDefinition } from '../../../operations';
import {
  ClaimQuota,
  SignupRecorded,
  UserRegistered,
} from '../../../operations';
import type { ILoggerService } from '../../logger';
import { ILogger } from '../../logger';
import { ActivityHub } from '../activity.hub';
import { EmailTaken } from '../user.errors';
import { UserService } from '../user.service';

import type { Output } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { deadlineIn } from '@nestling/ports';
import { httpEndpoint } from '@nestling/transport.http';
import type { z } from 'zod';

type CreateUserPayload = z.infer<typeof CreateUserInput>;
type CreateUserOutput = z.infer<typeof User>;

/**
 * Каррированная фабрика: внешний вызов происходит один раз, при получении
 * зависимостей из контейнера, а замыкание играет роль инстанса. Тестируется
 * без фреймворка: достаточно вызвать её с фейками, без контейнера и
 * транспорта.
 */
export const createUserHandler =
  (
    users: UserService,
    logger: ILoggerService,
    quotas: Port<typeof ClaimQuota>,
    registered: Emitter<typeof UserRegistered>,
    signup: Emitter<typeof SignupRecorded>,
    activity?: ActivityHub,
  ) =>
  async (
    payload: CreateUserPayload,
  ): Output<
    CreateUserOutput,
    ReturnType<typeof EmailTaken> | ReturnType<typeof QuotaExceededDefinition>
  > => {
    logger.log(`Handling POST /api/users - creating user ${payload.name}`);

    // Проверка на дубликат email
    const existing = await users.findByEmail(payload.email);
    if (existing) {
      // Статус CONFLICT, а не BAD_REQUEST: занятый email — конфликт с
      // данными, а не ошибка формата запроса
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

    // Соседняя фича вызывается через порт: вызов всегда асинхронный и
    // возвращает `Ok` или `Fail`, даже если фича работает в этом же
    // процессе. Разбирать отказ обязан вызывающий. Это та же дисциплина,
    // из-за которой переезд `quotas` в другой процесс не потребует
    // править здесь ни строчки.
    //
    // `deadline` задаёт бюджет вызова моментом, а не длительностью:
    // момент не «протухает» на await'ах и переживает передачу дальше.
    // Дефолта нет, потому что неявный таймаут однажды обрежет
    // разрешённую длинную операцию. Поэтому владелец endpoint'а задаёт
    // дедлайн явно: регистрация не должна висеть столько, сколько
    // захочет соседняя фича.
    const claimed = await quotas.call(
      { email: payload.email },
      { deadline: deadlineIn(QUOTA_CALL_BUDGET_MS) },
    );
    if (claimed.isFail) {
      // Исчерпанный бюджет попадает сюда кодом ядра `DEADLINE_EXCEEDED`
      // (504) и проходит проверку границы пайплайна нетронутым.
      // Декларировать его в `errors:` не нужно: он неявно входит в
      // операция любого endpoint'а.
      return claimed as ReturnType<typeof QuotaExceededDefinition>;
    }

    logger.log(`quota claimed, ${claimed.value.remaining} place(s) left`);

    const user = await users.create(payload);

    // Событие — fire-and-forget: `emit` резолвится по факту доставки, а не
    // обработки, и отказ подписчика сюда не всплывает
    await registered.emit({ id: user.id, email: user.email });

    // Команда — у неё ровно один владелец, поэтому у её `meta` есть
    // `idempotencyKey`. Ключом взят `user.id`: идентичность намерения шире
    // одного `emit`, и повторная отправка после падения процесса обязана
    // нести тот же ключ. Не передай мы его, вызывающий сгенерировал бы свой
    // ключ, и повторная попытка стала бы новым намерением
    await signup.emit(
      { userId: user.id, email: user.email },
      { idempotencyKey: user.id },
    );

    // Публикация в ленту: `push` не ждёт подписчиков, поэтому создание
    // пользователя не замедляется ни на одного SSE-клиента
    activity?.publish('created', user.id);

    return Ok.created(user, {
      Location: `/api/users/${user.id}`,
    });
  };

/**
 * Endpoint для создания пользователя — **операция-форма**.
 *
 * Адрес, схемы и `errors:` живут в операции `api.operations.ts`. Здесь
 * остаётся только исполнение. Пометку размещения (`dryRun` вытянут в
 * query-строку, `POST /api/users?dryRun=true`) объявляет та же операция,
 * поэтому клиент собирает запрос по той же карте, по которой транспорт его
 * разбирает. Присланный не в своё место `dryRun` (в теле) в payload не
 * попадёт: приём строгий.
 */
export const CreateUser = httpEndpoint({
  operation: CreateUserOperation,
  pipeline: basePipeline,
  deps: [
    UserService,
    ILogger,
    // Вызыватели инжектируются как обычные зависимости: узел появляется
    // только потому, что его здесь упомянули
    ClaimQuota.caller,
    UserRegistered.emitter,
    SignupRecorded.emitter,
    ActivityHub,
  ],
  handle: createUserHandler,
});
