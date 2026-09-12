import { User } from './api-operations.js';

import { makePipeline, withRequestId } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const page: z.infer<typeof User>[] = [
  { id: '1', name: 'Alice', email: 'a@example.com' },
];

/**
 * The address and the schemas are declared inline: an operation is only
 * needed when a client or a neighbouring feature calls the same thing.
 *
 * `limit` is not in the path and `GET` has no body, so it comes from the
 * query string. A function handler cannot inject anything — take a handler
 * class as soon as it needs a dependency.
 */
export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  pipeline: makePipeline().pre(withRequestId()),
  handler: async ({ limit }) => page.slice(0, limit),
});
