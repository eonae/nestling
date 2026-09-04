import { DatabaseModule } from '../database/index.js';

import { UserRepository } from './users.repository.js';
import { UserService } from './users.service.js';

import { makeModule } from '@nestling/container';

export const UsersModule = makeModule({
  name: 'module:users',
  providers: [UserRepository, UserService],
  dependsOn: [DatabaseModule],
});
