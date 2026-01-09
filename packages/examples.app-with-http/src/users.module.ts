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
  UploadAvatarEndpoint
} from './modules/users/endpoints';
import { TimingMiddleware } from './modules/users/middleware/timing.middleware';
import { UserService } from './modules/users/user.service';

/**
 * Модуль пользователей с endpoints и middleware
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService],
  middleware: [TimingMiddleware],
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

