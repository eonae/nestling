import { AppConfig } from '../config/app.config';

import { Logger } from './registry';

import { makePlugin } from '@nestling/app';
import type { Config } from '@nestling/config';
import { factoryProvider, familyProvider } from '@nestling/container';

/**
 * Плагин логирования: инфраструктура, к которой обращаются токеном из
 * любого модуля.
 */
export const appLogging = makePlugin({
  name: 'app-logging',
  providers: [
    // Один рецепт на всё семейство: `scope` — параметр запрошенного члена.
    // Уровень читается из секции конфига, как любая зависимость
    familyProvider(Logger, (scope) =>
      factoryProvider(
        Logger(scope),
        (config: Config<typeof AppConfig>) => ({
          log: (...args: unknown[]) =>
            // eslint-disable-next-line no-console
            console.log(`[${config.logLevel}] Logger:${scope}`, ...args),
        }),
        [AppConfig] as const,
      ),
    ),
  ],
});
