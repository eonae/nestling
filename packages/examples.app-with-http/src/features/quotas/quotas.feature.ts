import { ClaimQuotaImpl } from './claim-quota.endpoint.js';
import { QuotaService } from './quota.service.js';
import { SignupJournal } from './signup.journal.js';
import { SignupRecordedImpl } from './signup-recorded.endpoint.js';
import { UserRegisteredInQuotas } from './user-registered-in-quotas.endpoint.js';

import { makeFeature } from '@nestling/app';

/**
 * Фича квот: владелец `quotas.claim` и `quotas.record-signup`, подписчик
 * `users.registered`.
 *
 * В `providers:` только собственные сервисы. Наружу фича отдаёт операции,
 * а не токены, поэтому её можно вынести в отдельный процесс без правок в
 * фиче `users`.
 */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  providers: [QuotaService, SignupJournal],
  endpoints: [ClaimQuotaImpl, UserRegisteredInQuotas, SignupRecordedImpl],
});
