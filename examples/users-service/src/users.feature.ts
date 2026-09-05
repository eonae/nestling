import {
  CreateUser,
  DeleteUser,
  ExportUsers,
  GetUser,
  ImportUsers,
  ListUsers,
  UploadAvatar,
} from './users/endpoints/index.js';
import { DbUsersRepository } from './users/users.repository.js';
import { Authenticate } from './auth.js';
import { Database } from './database.js';
import { ConsoleLogger } from './logging.js';
import { AuditOutcome } from './observability.js';

import { makeFeature } from '@nestling/app';

/**
 * Фича пользователей: провайдеры и endpoint'ы.
 *
 * В `providers:` перечислены сервисы и классы-юниты пайплайна.
 * Классы-хендлеры сюда не попадают: каждый endpoint регистрирует свой
 * сам.
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
    ListUsers,
    GetUser,
    CreateUser,
    DeleteUser,
    UploadAvatar,
    ExportUsers,
    ImportUsers,
  ],
});
