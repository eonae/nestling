import type { MetricsOf } from '@nestlingjs/app';
import { counter, histogram, makeMetrics, open } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

/**
 * A group of metrics is a value. The name of a metric is the prefix of the
 * group plus the key of the record — `users.registered` here — and there
 * is no other way to name one.
 *
 * An attribute is declared either by the list of its values or by the mark
 * `open`. A list gives the set of series on the build, so the exposition
 * shows zeroes before the first request, and a value outside the list does
 * not compile.
 */
// #region declare
export const UsersMetrics = makeMetrics('users', {
  registered: counter({
    help: 'Registered users',
    attributes: { tier: ['free', 'paid'], source: open },
  }),
  'signup.duration': histogram({
    help: 'Time to register',
    unit: 'ms',
    buckets: [5, 25, 100, 500, 1000],
  }),
});
// #endregion

/**
 * The group is its own DI token: the writer arrives typed by the
 * declaration, the metric is picked by a field, and a record nobody
 * declared cannot be written.
 */
// #region write
@Component([UsersMetrics])
export class SignupCounter {
  constructor(private readonly metrics: MetricsOf<typeof UsersMetrics>) {}

  record(elapsed: number): void {
    this.metrics.registered.add({ tier: 'paid', source: 'web' });
    this.metrics['signup.duration'].record(elapsed);
  }
}
// #endregion
