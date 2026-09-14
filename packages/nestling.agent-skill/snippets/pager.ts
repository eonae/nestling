import { AppConfig } from './app.config.js';

import type { Config } from '@nestlingjs/app';
import { Component } from '@nestlingjs/container';

/**
 * A section is a DI token: depend on it and read its fields. There is no
 * `ConfigService` and no `get('some.key')`, so a typo is a compile error
 * and the type of a field comes from its schema.
 */
// #region reading
@Component([AppConfig])
export class Pager {
  constructor(private readonly config: Config<typeof AppConfig>) {}

  size(): number {
    return this.config.pageSize;
  }
}
// #endregion
