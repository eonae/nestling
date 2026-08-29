import { AppConfig } from '../config/app.config';

import { ILogger } from './registry';

import type { Config } from '@nestling/config';
import {
  factoryProvider,
  familyProvider,
  makeModule,
} from '@nestling/container';

export const LoggingModule = makeModule({
  name: 'module:logging',
  providers: [
    // Один рецепт на всё семейство — контейнер сам создаёт члена на каждый
    // скоуп, упомянутый в deps зарегистрированных провайдеров. Рецепт зависит
    // от секции конфига наравне с любым другим провайдером: `APP_LOG_LEVEL`
    // приходит из объектного источника, привязанного в корне.
    familyProvider(ILogger, (scope) =>
      factoryProvider(
        ILogger(scope),
        (config: Config<typeof AppConfig>) => ({
          log: (...args: unknown[]) =>
            // eslint-disable-next-line no-console
            console.log(`[${config.logLevel}] Logger:${scope}`, ...args),
        }),
        [AppConfig] as const,
      ),
    ),
  ],
  exports: [ILogger],
});
