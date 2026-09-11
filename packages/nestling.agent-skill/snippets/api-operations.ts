import { EmailTaken, Unauthorized, UserNotFound } from './errors.js';
import { QuotaExceeded } from './intercom-operations.js';

import { makeRequest, query } from '@nestlingjs/operations';
import { z } from 'zod';

export const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
});

export type User = z.infer<typeof User>;

export const GetUserInput = z.object({ id: z.string() });

export type GetUserInput = z.infer<typeof GetUserInput>;

/** `id` is taken from the path because the path declares `:id` */
export const GetUser = makeRequest({
  name: 'users.get',
  http: 'GET /users/:id',
  input: GetUserInput,
  output: User,
  errors: [UserNotFound],
  doc: { summary: 'User by id', tags: ['users'] },
});

export const CreateUserInput = z.object({
  name: z.string().min(1),
  email: z.email(),
  // Query carries strings, so `z.stringbool()`: `z.boolean()` would reject
  // `?dryRun=true`
  dryRun: z.stringbool().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserInput>;

/**
 * `errors:` lists the failures of the handler, of a neighbouring feature
 * and of the `authed` layer: the client must know the same set the server
 * can answer with. `bind` moves one field out of its default place — for a
 * POST that is the body.
 */
export const CreateUser = makeRequest({
  name: 'users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken, QuotaExceeded, Unauthorized],
  doc: { summary: 'Create user', tags: ['users'], status: 'created' },
});
