import { appConfigKeys } from './app.config.js';
import { app } from './app.js';

import { argv, bind, defaultSources, dotenv } from '@nestlingjs/app';

/**
 * The entry point of a service. `argv(process.argv)` hands the command line
 * to the build: the flags come from the declaration, so `--features users
 * --include-deps` and `--help` need no parser of their own.
 *
 * Config bindings are an option of `run()`, not a field of the declaration:
 * what a process runs is decided by the build argument, and where its
 * values come from — by the run.
 */
// #region sources
await app.build(argv(process.argv)).run({
  config: [
    bind(dotenv('config/local.env'), {
      keys: appConfigKeys,
      optional: true,
    }),
    ...defaultSources,
  ],
});
// #endregion
