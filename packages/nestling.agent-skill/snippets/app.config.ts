import { from, makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

/**
 * A config section: a prefix and a field per value. The variable name is
 * the prefix plus the field name in upper case (`APP_PAGE_SIZE`); `from()`
 * sets it exactly. A field without a default is required, and a missing
 * value stops the process before the first request.
 */
export const AppConfig = makeConfig(
  'app',
  {
    pageSize: z.coerce.number().int().positive().default(20),
    // `secret()` hides the value in printouts and in error texts
    databaseUrl: secret(
      from('DATABASE_URL', z.url().default('postgresql://localhost/app')),
    ),
    apiToken: secret(from('API_TOKEN', z.string().min(1))),
  },
  // Derived fields have no variable of their own and are computed once,
  // when the section is validated
  (derived) => ({
    databaseHost: derived(['databaseUrl'], (url) => new URL(url).host),
  }),
);

/** The right to bind a source to the section keys; it does not read values */
export const appConfigKeys = AppConfig.keys;
