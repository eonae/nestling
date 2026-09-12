import type { Output } from '@nestlingjs/app';
import { makeApp, makeFeature } from '@nestlingjs/app';
import { makeFail } from '@nestlingjs/operations';
import { http, httpEndpoint } from '@nestlingjs/transport.http';
import { z } from 'zod';

const User = z.object({ id: z.string(), name: z.string() });

type User = z.infer<typeof User>;

/** A failure is a value with a machine-readable code, not an exception class */
const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

const users = new Map<string, User>([['1', { id: '1', name: 'Alice' }]]);

/** An endpoint is a value: address, schemas, declared failures, handler */
const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: User,
  errors: [UserNotFound],
  handler: async ({ id }): Output<User, typeof UserNotFound> =>
    users.get(id) ?? UserNotFound({ id }),
});

/** A feature owns endpoints and providers. An app is a list of features */
const UsersFeature = makeFeature({ name: 'users', endpoints: [GetUser] });

// `assemble()` picks what this process runs; `run()` builds the graph,
// walks the phases, opens the socket and stops on SIGTERM
await makeApp({ features: [UsersFeature], transports: [http()] })
  .assemble()
  .run();
