import { ActivityHub } from './users/activity.hub.js';
import {
  ActivityStream,
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  ImportUsers,
  ListUsers,
  Login,
  UpdateUser,
  UploadAvatar,
  UserWebhook,
  VerifySignature,
  WelcomeEmail,
} from './users/endpoints/index.js';
import {
  CreateUserTool,
  GetUserTool,
  SearchUsersTool,
} from './users/tools/index.js';
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
 * сам. Соединение с базой и юнит слоя транзакции приходят плагинами
 * пакета `@nestlingjs/drizzle.pg`: то же соединение инжектит хранилище
 * outbox'а, а плагин не имеет права зависеть от DI-токена фичи.
 *
 * Инструменты агента лежат в том же списке `endpoints:`: у транспорта MCP
 * декларации такие же, как у HTTP, и состав инструментов виден там же,
 * где состав любого другого транспорта.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    classProvider(UsersRepository$, DbUsersRepository),
    ActivityHub,
    AuditOutcome,
    Authenticate,
    VerifySignature,
  ],
  endpoints: [
    ListUsers,
    GetUser,
    Login,
    CreateUser,
    UpdateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
    ActivityStream,
    UserWebhook,
    WelcomeEmail,
    GetUserTool,
    CreateUserTool,
    SearchUsersTool,
  ],
});
