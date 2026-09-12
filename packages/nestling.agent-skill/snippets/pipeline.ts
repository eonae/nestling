import { AppConfig } from './app.config.js';
import { Unauthorized } from './errors.js';

import type {
  Config,
  EmptyInput,
  ExtendableContext,
  Logger,
  Outcome,
  ResponseContext,
} from '@nestlingjs/app';
import {
  compose,
  Logger$,
  makePipeline,
  makePlugin,
  withRequestId,
} from '@nestlingjs/app';
import { Handler } from '@nestlingjs/container';

/**
 * A `.pre` unit runs before the handler and adds typed fields to the
 * context. There is no `next()`: units do not wrap each other.
 */
@Handler([AppConfig])
export class Authenticate {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  handle(
    ctx: ExtendableContext<EmptyInput>,
  ): { caller: { id: string } } | ReturnType<typeof Unauthorized> {
    const header = ctx.raw.attributes.authorization;

    // Returning a failure stops the request: no later unit, no handler
    return header === `Bearer ${this.config.apiToken}`
      ? { caller: { id: 'api-token' } }
      : Unauthorized();
  }
}

/** A `.finally` unit runs on every outcome, success and failure alike */
@Handler([Logger$.auto])
export class AuditOutcome {
  constructor(private readonly logger: Logger) {}

  handle(
    outcome: Outcome,
    res: ResponseContext,
    ctx: ExtendableContext<{ requestId?: string }>,
  ): void {
    this.logger.info(`${ctx.raw.pattern} ${res.status}`, { outcome });
  }
}

/** A layer is a value: endpoints reference it, policies compare it by identity */
export const observability = makePipeline()
  .pre(withRequestId())
  .finally(AuditOutcome);

/** `compose` stacks layers; the failure declared here joins `errors:` */
export const authed = compose(
  observability,
  makePipeline().pre(Authenticate, { errors: [Unauthorized] }),
);

/** Unit classes are providers: without registration the layer does not build */
export const appPipeline = makePlugin({
  name: 'app-pipeline',
  providers: [Authenticate, AuditOutcome],
});
