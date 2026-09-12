import {
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  ImportUsers,
  ListUsers,
  UploadAvatar,
  WelcomeEmail,
} from './users/endpoints/index.js';
import {
  DbUsersRepository,
  UsersRepository$,
} from './users/users.repository.js';
import { Authenticate } from './auth.js';
import { AuditOutcome } from './observability.js';

import { makeFeature } from '@nestlingjs/app';
import { classProvider } from '@nestlingjs/container';

/**
 * Фича пользователей: провайдеры и endpoint'ы.
 *
 * В `providers:` перечислены сервисы и классы-юниты пайплайна.
 * Классы-хендлеры сюда не попадают: каждый endpoint регистрирует свой
 * сам. Соединение с базой и юнит слоя транзакции приходят плагинами пакета `@nestlingjs/drizzle.pg`: то же соединение инжектит
 * хранилище outbox'а, а плагин не имеет права зависеть от DI-токена
 * фичи.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    classProvider(UsersRepository$, DbUsersRepository),
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
