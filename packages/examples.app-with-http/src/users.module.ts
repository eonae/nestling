import { makeAppModule } from '@nestling/app';
import { CreateUserEndpoint } from './create-user.endpoint';
import { GetUserEndpoint } from './get-user.endpoint';
import { ListUsersEndpoint } from './list-users.endpoint';
import { TimingMiddleware } from './timing.middleware';
import { UserService } from './user.service';

/**
 * Модуль пользователей с endpoints и middleware
 */
export const UsersModule = makeAppModule({
  name: 'module:users',
  providers: [UserService],
  middleware: [TimingMiddleware],
  endpoints: [GetUserEndpoint, ListUsersEndpoint, CreateUserEndpoint],
});

