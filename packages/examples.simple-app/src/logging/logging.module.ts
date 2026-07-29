import { ILogger } from './registry';

import { familyProvider, makeModule, valueProvider } from '@nestling/container';

export const LoggingModule = makeModule({
  name: 'module:logging',
  providers: [
    // Один рецепт на всё семейство — контейнер сам создаёт члена на каждый
    // скоуп, упомянутый в deps зарегистрированных провайдеров.
    familyProvider(ILogger, (scope) =>
      valueProvider(ILogger(scope), {
        // eslint-disable-next-line no-console
        log: (...args) => console.log(`[LOG] Logger:${scope}`, ...args),
      }),
    ),
  ],
  exports: [ILogger],
});
