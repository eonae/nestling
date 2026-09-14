import { UserNotFound } from './errors.js';
import { ClaimQuota } from './intercom-operations.js';

import { errorsOf, makeRequest } from '@nestlingjs/operations';
import { z } from 'zod';

/**
 * A caller answers with the failures of the operation it calls, so that
 * list belongs in its own `errors:`. `errorsOf` reads it off the
 * declaration instead of copying it: a failure added to `ClaimQuota`
 * reaches this operation without an edit here.
 */
// #region errors-of
export const CreateOrder = makeRequest({
  name: 'orders.create',
  input: z.object({ userId: z.string() }),
  output: z.object({ id: z.string() }),
  errors: [UserNotFound, ...errorsOf(ClaimQuota)],
});
// #endregion
