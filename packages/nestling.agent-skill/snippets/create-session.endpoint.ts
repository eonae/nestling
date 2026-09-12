import { observability } from './pipeline.js';

import { Ok } from '@nestlingjs/operations';
import { httpEndpoint, HttpResponse } from '@nestlingjs/transport.http';
import { z } from 'zod';

const Session = z.object({ id: z.string(), expiresAt: z.string() });

/** How long a session cookie lives, in seconds */
const SESSION_TTL = 3600;

/**
 * `HttpResponse.of(result, { headers, cookies })` wraps the result of the
 * handler: `Ok.created` keeps the success status, and the options carry
 * what belongs to HTTP rather than to the value.
 *
 * `detached:` takes the endpoint out of the assembly policies and says why
 * in one sentence: this is the call that issues the token, so the `authed`
 * layer the root requires of every `POST` cannot run before it.
 */
export const CreateSession = httpEndpoint({
  method: 'POST',
  path: '/sessions',
  input: z.object({ email: z.email() }),
  output: Session,
  pipeline: observability,
  detached: 'a session issues the token that the authed layer checks',
  doc: { summary: 'Open a session', tags: ['users'], status: 'created' },
  handler: async () => {
    const session = { id: 'sid-1', expiresAt: new Date().toISOString() };

    return HttpResponse.of(Ok.created(session), {
      headers: { location: `/sessions/${session.id}` },
      cookies: [
        {
          name: 'sid',
          value: session.id,
          path: '/',
          maxAge: SESSION_TTL,
          httpOnly: true,
          sameSite: 'lax',
        },
      ],
    });
  },
});
