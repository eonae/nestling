import {
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

import { makeAppModule } from '@nestling/app';

/**
 * Модуль пользователей с endpoints
 *
 * `endpoints:` — список деклараций-значений; инстанцировать в них нечего.
 * Зависимости хендлеров регистрируются явно, как любые другие провайдеры:
 * `UserService` (токен из `deps` каррированных ручек) и класс-хендлеры
 * (форма подключения DI). Middleware добавляются через pipeline в каждой
 * декларации.
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [
    UserService,
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
    UploadAvatar,
    UserWebhook,
  ],
});
