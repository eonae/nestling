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
import { makeFeature } from '@nestling/app';
import { makeModule } from '@nestling/container';

/**
 * Модуль пользователей: только провайдеры.
 *
 * Зависимости хендлеров регистрируются здесь явно, как любые другие:
 * `UserService` для каррированных хендлеров и классы-хендлеры для
 * класс-формы. Слои пайплайна каждая декларация подключает сама.
 *
 * Логирование модулем не подключается: это плагин, он есть в каждом
 * процессе, и к нему обращаются токеном.
 */
const UsersModule = makeModule({
  name: 'module:users',
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
});

/**
 * Фича пользователей.
 *
 * `endpoints:` живут на фиче, а не на модуле: модуль контейнера группирует
 * провайдеры, декларации объявляет единица слоя приложения.
 *
 * Поля `dependsOn` у фичи нет. Связь с `quotas` выводится из объявленных
 * операций: `users` вызывает `quotas.claim`, и это записано в `deps`
 * декларации.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
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
