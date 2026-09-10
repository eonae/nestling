import {
  makeCommand,
  makeEvent,
  makeFail,
  makeRequest,
} from '@nestlingjs/operations';
import { z } from 'zod';

export const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', {
  details: z.object({ limit: z.number() }),
  message: (d) => `User quota of ${d.limit} is exhausted`,
});

/** `request`: one owner, and the caller cannot go on without the answer */
export const ClaimQuota = makeRequest({
  name: 'quotas.claim',
  input: z.object({ email: z.string() }),
  output: z.object({ remaining: z.number() }),
  errors: [QuotaExceeded],
});

/** `event`: the fact already happened, any number of subscribers, no answer */
export const UserRegistered = makeEvent({
  name: 'users.registered',
  input: z.object({ id: z.string(), email: z.string() }),
});

/** `command`: one owner, and `meta.idempotencyKey` tells a retry apart */
export const SignupRecorded = makeCommand({
  name: 'quotas.record-signup',
  input: z.object({ userId: z.string() }),
});
