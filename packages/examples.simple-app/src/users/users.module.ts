import { DatabaseModule } from '../database';

import { UserRepository } from './users.repository';
import { UserService } from './users.service';

import { makeModule } from '@nestling/container';

export const UsersModule = makeModule({
  name: 'module:users',
  providers: [UserRepository, UserService],
  exports: [UserService],
  imports: [DatabaseModule],
});
