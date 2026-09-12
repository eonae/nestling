import { makeFail } from '@nestlingjs/operations';
import { z } from 'zod';

/**
 * A failure definition. The code is `category[:refinement]`: the first
 * segment comes from a closed list and decides the HTTP status, the rest
 * refines it for the caller.
 */
export const UserNotFound = makeFail('not_found:user', {
  details: z.object({ id: z.string() }),
  message: (d) => `User ${d.id} not found`,
});

export const EmailTaken = makeFail('conflict:email_taken', {
  details: z.object({ email: z.string() }),
  message: (d) => `Email ${d.email} already taken`,
});

/** Details are optional: without them the definition takes no argument */
export const Unauthorized = makeFail('unauthorized', {
  message: 'Bearer token is missing or invalid',
});
