import { makeModule } from '../../framework';
import { DatabaseModule } from '../database';
import { UserRepository } from './users.repository';
import { UserService } from './users.service';

export const UsersModule = makeModule({
  name: 'module:users',
  providers: [
    UserRepository,
    UserService,
  ],
  exports: [UserService],
  imports: [DatabaseModule],
});