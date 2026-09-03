import {
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  Health,
  ImportUsers,
  ListUsers,
  UploadAvatar,
} from './users/endpoints';
import { DbUsersRepository } from './users/users.repository';
import { Authenticate } from './auth';
import { Database } from './database';
import { ConsoleLogger } from './logging';
import { AuditOutcome } from './observability';

import { makeFeature } from '@nestling/app';

/**
 * Фича пользователей: провайдеры и endpoint'ы.
 *
 * В `providers:` перечислено всё, что контейнер создаёт: сервисы и
 * классы-юниты пайплайна. Endpoint'ы получают зависимости из `deps`.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    ConsoleLogger,
    Database,
    DbUsersRepository,
    AuditOutcome,
    Authenticate,
  ],
  endpoints: [
    Health,
    ListUsers,
    GetUser,
    CreateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
  ],
});
