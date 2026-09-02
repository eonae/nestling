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
 * Модуль пользователей.
 *
 * `endpoints:` — список деклараций-значений. Зависимости хендлеров
 * регистрируются в `providers:` явно, как любые другие: `UserService` для
 * каррированных хендлеров и классы-хендлеры для класс-формы. Слои
 * пайплайна каждая декларация подключает сама.
 *
 * `dependsOn: [appLogging]` подключает инфраструктуру вместе с фичей: если
 * `users` не выбрана, логгера в графе нет; если две фичи импортируют одно
 * и то же значение, экземпляр один на процесс.
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  dependsOn: [appLogging],
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
