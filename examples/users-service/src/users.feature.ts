import {
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  ImportUsers,
  ListUsers,
  SeenKeys$,
  UploadAvatar,
  WelcomeEmail,
} from './users/endpoints/index.js';
import {
  DbUsersRepository,
  UsersRepository$,
} from './users/users.repository.js';
import { Authenticate } from './auth.js';
import { AuditOutcome } from './observability.js';

import { makeFeature } from '@nestling/app';
import { classProvider, valueProvider } from '@nestling/container';

/**
 * Фича пользователей: провайдеры и endpoint'ы.
 *
 * В `providers:` перечислены сервисы и классы-юниты пайплайна.
 * Классы-хендлеры сюда не попадают: каждый endpoint регистрирует свой
 * сам. Соединение с базой и юнит слоя транзакции лежат в плагине
 * `persistence`: их же инжектит relay outbox'а, а плагин не имеет права
 * зависеть от DI-токена фичи.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    classProvider(UsersRepository$, DbUsersRepository),
    valueProvider(SeenKeys$, new Set<string>()),
    AuditOutcome,
    Authenticate,
  ],
  endpoints: [
    ListUsers,
    GetUser,
    CreateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
    WelcomeEmail,
  ],
});
