import { makeAppModule } from '@nestling/app';
import {
  CreateUserEndpoint,
  DeleteUserEndpoint,
  ExportUsersEndpoint,
  GetUserEndpoint,
  ImportUsersEndpoint,
  ListUsersEndpoint,
  SearchUsersEndpoint,
  UpdateUserEndpoint,
  UploadAvatarEndpoint,
} from './modules/users/endpoints';
import { UserService } from './modules/users/user.service';

/**
 * Модуль пользователей с endpoints
 * Middleware теперь добавляются через pipeline в каждом endpoint'е
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService],
  endpoints: [
    GetUserEndpoint,
    ListUsersEndpoint,
    CreateUserEndpoint,
    UpdateUserEndpoint,
    DeleteUserEndpoint,
    SearchUsersEndpoint,
    ExportUsersEndpoint,
    ImportUsersEndpoint,
    UploadAvatarEndpoint,
  ],
});
