import { ActivityHub } from './activity.hub';
import { Database } from './database';
import {
  ActivityStream,
  AuditDeletion,
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  ImportUsers,
  ListUsers,
  UpdateUser,
  UploadAvatar,
  UserWebhook,
  VerifySignature,
} from './endpoints';
import { DbUsersRepository } from './users.repository';

import { makeFeature } from '@nestling/app';
import { makeModule } from '@nestling/container';

/**
 * Модуль пользователей: группирует провайдеры фичи под именем.
 *
 * В списке сервисы и классы юнитов пайплайна. Класс-хендлер
 * (`ExportUsersHandler`) сюда не попадает: его регистрирует сам endpoint.
 * Endpoint'ы у модуля не перечисляются.
 */
export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    Database,
    DbUsersRepository,
    ActivityHub,
    AuditDeletion,
    VerifySignature,
  ],
});

/**
 * Фича пользователей: модули и endpoint'ы.
 *
 * Связь с фичей `quotas` не объявляется полем: она выводится из операций,
 * которые endpoint'ы вызывают через зависимости хендлера.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [
    ListUsers,
    GetUser,
    CreateUser,
    UpdateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
    ActivityStream,
    UserWebhook,
  ],
});
