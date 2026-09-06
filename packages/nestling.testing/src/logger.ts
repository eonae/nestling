/**
 * `spyLogger()` — логгер, который копит записи значениями.
 *
 * Подмена `[RootLogger$, spy.logger]` в `overrides` перехватывает записи
 * всех членов `Logger$` — и ядра, и приложения: рецепт семейства строит
 * член как `root.child({ scope })`, и дочерний логгер шпиона пишет в тот
 * же список. Тест проверяет `entries`, а не разбирает `stderr`.
 */

import type { Fields, Logger, LogLevel } from '@nestling/app';

/** Одна запись логгера-шпиона */
export interface LogEntry {
  /** Уровень записи */
  readonly level: LogLevel;

  /** Сообщение; для формы `(fields)` — пустая строка */
  readonly message: string;

  /** Привязки дочерних логгеров и поля вызова; ошибка — в `err` */
  readonly fields: Fields;
}

/** Логгер-шпион и его записи */
export interface SpyLogger {
  /** Логгер для подмены `RootLogger$` или передачи в юнит напрямую */
  readonly logger: Logger;

  /** Записи в порядке вызовов, включая записи дочерних логгеров */
  readonly entries: readonly LogEntry[];
}

/** Первый аргумент метода уровня: одна из трёх форм вызова */
type FirstArgument = string | Error | Fields;

const makeLogger = (entries: LogEntry[], bindings: Fields): Logger => {
  const write =
    (level: LogLevel) =>
    (first: FirstArgument, second?: Fields): void => {
      if (typeof first === 'string') {
        entries.push({
          level,
          message: first,
          fields: { ...bindings, ...second },
        });
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

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (extra) => makeLogger(entries, { ...bindings, ...extra }),
  };
};

/**
 * Создаёт логгер-шпион.
 *
 * @returns Логгер и список его записей
 *
 * @example
 * ```typescript
 * const spy = spyLogger();
 * await using testApp = await assembleTest(app, {
 *   overrides: [[RootLogger$, spy.logger]],
 * });
 *
 * await testApp.call(GetUser, { id: '1' });
 *
 * expect(spy.entries).toContainEqual({
 *   level: 'info',
 *   message: 'byId',
 *   fields: { scope: 'UsersRepository', id: '1' },
 * });
 * ```
 */
export function spyLogger(): SpyLogger {
  const entries: LogEntry[] = [];

  return { logger: makeLogger(entries, {}), entries };
}
