/**
 * Логгер-шпион для спек пакета: копит записи значениями.
 *
 * Тот же контракт, что у `spyLogger()` из `@nestling/testing`; свой
 * экземпляр здесь потому, что `@nestling/testing` зависит от этого
 * пакета, а не наоборот.
 */

import type { Fields, Logger, LogLevel } from '../interface.js';

export interface SpyEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: Fields;
}

export interface SpyLogger {
  readonly logger: Logger;
  readonly entries: readonly SpyEntry[];
}

const record = (
  entries: SpyEntry[],
  bindings: Fields,
  level: LogLevel,
  first: string | Error | Fields,
  second?: Fields,
): void => {
  if (typeof first === 'string') {
    entries.push({ level, message: first, fields: { ...bindings, ...second } });
  } else if (first instanceof Error) {
    entries.push({
      level,
      message: first.message,
      fields: { ...bindings, ...second, err: first },
    });
  } else {
    entries.push({ level, message: '', fields: { ...bindings, ...first } });
  }
};

const makeLogger = (entries: SpyEntry[], bindings: Fields): Logger => ({
  debug: (first: string | Error | Fields, second?: Fields) =>
    record(entries, bindings, 'debug', first, second),
  info: (first: string | Error | Fields, second?: Fields) =>
    record(entries, bindings, 'info', first, second),
  warn: (first: string | Error | Fields, second?: Fields) =>
    record(entries, bindings, 'warn', first, second),
  error: (first: string | Error | Fields, second?: Fields) =>
    record(entries, bindings, 'error', first, second),
  child: (extra) => makeLogger(entries, { ...bindings, ...extra }),
});

/** Создаёт логгер-шпион: записи всех дочерних логгеров идут в один список */
export function spyLogger(): SpyLogger {
  const entries: SpyEntry[] = [];

  return { logger: makeLogger(entries, {}), entries };
}
