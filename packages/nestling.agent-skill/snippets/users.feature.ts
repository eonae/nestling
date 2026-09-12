import {
  ClaimQuotaImpl,
  QuotaService,
  UserRegisteredInQuotas,
} from './claim-quota.endpoint.js';
import { CreateSession } from './create-session.endpoint.js';
import { CreateUser } from './create-user.endpoint.js';
import { GetUser } from './get-user.endpoint.js';
import { ListUsers } from './list-users.endpoint.js';
import { GetAvatar } from './redirect.endpoint.js';
import { UsersModule } from './users.module.js';

import { makeFeature } from '@nestlingjs/app';

export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  endpoints: [GetUser, GetAvatar, ListUsers, CreateUser, CreateSession],
});

export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas],
});
