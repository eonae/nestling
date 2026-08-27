import { ActivityHub } from './modules/users/activity.hub';
import {
  ActivityStream,
  CreateUser,
  DeleteUser,
  ExportUsers,
  ExportUsersHandler,
  GetUser,
  ImportUsers,
  ImportUsersHandler,
  ListUsers,
  SearchUsers,
  SearchUsersHandler,
  UpdateUser,
  UploadAvatar,
  UploadAvatarHandler,
  UserWebhook,
} from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';
import { StoredUsersRepository } from './modules/users/users.repository';
import { UsersStore } from './modules/users/users.store';
import { appLogging } from './infrastructure';

import { makeAppModule } from '@nestling/app';

/**
 * Модуль пользователей с endpoints
 *
 * `endpoints:` — список деклараций-значений; инстанцировать в них нечего.
 * Зависимости хендлеров регистрируются явно, как любые другие провайдеры:
 * `UserService` (токен из `deps` каррированных ручек) и класс-хендлеры
 * (форма подключения DI). Middleware добавляются через pipeline в каждой
 * декларации.
 *
 * `imports: [appLogging]` — инфраструктура едет вместе с фичей: не выбрали
 * `users` — логгера в графе нет вовсе, выбрали вместе с соседней фичей,
 * импортирующей то же значение, — инстанс один на процесс.
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  imports: [appLogging],
  providers: [
    UsersStore,
    StoredUsersRepository,
    UserService,
    ActivityHub,
    SearchUsersHandler,
    ExportUsersHandler,
    ImportUsersHandler,
    UploadAvatarHandler,
  ],
  endpoints: [
    GetUser,
    ListUsers,
    CreateUser,
    UpdateUser,
    DeleteUser,
    SearchUsers,
    ExportUsers,
    ImportUsers,
    ActivityStream,
    UploadAvatar,
    UserWebhook,
  ],
});
