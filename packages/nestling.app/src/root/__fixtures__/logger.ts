/**
 * Шпион логгера для спек сборки: его ставят корневым логгером приложения.
 *
 * Опция `logger` корня — единственный способ заменить корень, поэтому все
 * записи ядра и приложения, включая записи фаз 0 и 1, попадают в
 * `entries`.
 */

import type { SpyEntry, SpyLogger } from '../../logger/__fixtures__/spy.js';
import { spyLogger } from '../../logger/__fixtures__/spy.js';

/** Шпион логгера: значение для поля `logger` корня */
export type LoggerProbe = SpyLogger;

/** Создаёт шпион для `logger:` корня */
export function loggerProbe(): LoggerProbe {
  return spyLogger();
}

/** Записи с заданным сообщением */
export const entriesWith = (probe: LoggerProbe, message: string): SpyEntry[] =>
  probe.entries.filter((entry) => entry.message === message);

export { type SpyEntry } from '../../logger/__fixtures__/spy.js';
