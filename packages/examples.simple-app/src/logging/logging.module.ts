import { loggersRegistry } from './registry';

import { makeModule, valueProvider } from '@nestling/container';

export const LoggingModule = makeModule({
  name: 'module:logging',
  providers: () =>
    [...loggersRegistry.values()].map((token) => {
      return valueProvider(token, {
        // eslint-disable-next-line no-console
        log: (...args) => console.log('[LOG] ' + token, ...args),
      });
    }),
});
