import { appPipeline, authed, observability } from './pipeline.js';
import { QuotasFeature, UsersFeature } from './users.feature.js';

import { everyEndpoint, makeApp } from '@nestlingjs/app';
import { http, HttpTransport$ } from '@nestlingjs/transport.http';

/**
 * The application declaration: one value for `main.ts`, for tests and for
 * the topology check. Policies are invariants over the assembled graph and
 * are checked before INIT, so a missing layer stops the process instead of
 * showing up on some request in production.
 */
export const app = makeApp({
  features: [UsersFeature, QuotasFeature],
  plugins: [appPipeline],
  transports: [http()],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
  ],
});
