import { observability } from './pipeline.js';

import { httpEndpoint, HttpResponse } from '@nestlingjs/transport.http';
import { z } from 'zod';

/**
 * A redirect is declared twice. The field `redirect:` says the endpoint
 * answers with a 3xx and gives the default status; the handler says where
 * to. Without the field the answer is `internal_error`, because the
 * declaration is what the transport and the OpenAPI document read.
 *
 * There is no `output:`: a 3xx carries no body.
 */
export const GetAvatar = httpEndpoint({
  method: 'GET',
  path: '/users/:id/avatar',
  input: z.object({ id: z.string() }),
  redirect: 302,
  pipeline: observability,
  handler: async ({ id }) =>
    HttpResponse.redirect(`https://cdn.example.com/avatars/${id}.png`),
});
