/**
 * Шпион логгера для спек сборки: провайдер ставит его корнем приложения.
 *
 * Провайдер под `RootLogger$` в `providers:` корня заменяет умолчание
 * kernel-модуля, поэтому все записи ядра и приложения попадают в `entries`.
 */

import type { SpyEntry, SpyLogger } from '../../logger/__fixtures__/spy.js';
import { spyLogger } from '../../logger/__fixtures__/spy.js';
import { RootLogger$ } from '../../logger/tokens.js';

import type { Provider } from '@nestling/container';
import { valueProvider } from '@nestling/container';

/** Шпион и провайдер, который делает его корнем сборки */
export interface LoggerProbe extends SpyLogger {
  readonly provider: Provider;
}

/** Создаёт шпион и провайдер `RootLogger$` для `providers:` корня */
export function loggerProbe(): LoggerProbe {
  const spy = spyLogger();

  return {
    logger: spy.logger,
    entries: spy.entries,
    provider: valueProvider(RootLogger$, spy.logger),
  };
}

/** Записи с заданным сообщением */
export const entriesWith = (probe: LoggerProbe, message: string): SpyEntry[] =>
  probe.entries.filter((entry) => entry.message === message);

export { type SpyEntry } from '../../logger/__fixtures__/spy.js';
