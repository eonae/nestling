/**
 * Поток назначения pino: строка уходит в `process.stderr` в том же тике.
 *
 * `process.stderr.write`, а не `pino.destination`: запись, ушедшая мимо
 * потока процесса, невидима и перехвату в тесте, и перехвату вывода в
 * приложении. Синхронность здесь важнее пропускной способности —
 * аварийный выход процесса не должен терять последние строки.
 *
 * В `json` строку сформировал pino, и писатель отдаёт её как есть. В
 * `text` он разбирает её обратно в `LogEntry` и печатает через
 * `formatLine`: формат разработчика один на весь репозиторий. Двойная
 * работа здесь осознанна — в `json`, которым пишет прод, её нет.
 */

import type { LogEntry, LogFormat, LogLevel } from '@nestlingjs/logging';
import { formatLine } from '@nestlingjs/logging';

/** Поток назначения: pino знает о нём один метод */
export interface Destination {
  write(line: string): void;
}

/** Метки уровней интерфейса `Logger`: ими подписаны записи адаптера */
const LEVELS = new Set<string>([
  'debug',
  'info',
  'warn',
  'error',
] satisfies LogLevel[]);

const isLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && LEVELS.has(value);

/**
 * Разбирает строку pino обратно в запись формата.
 *
 * `undefined` — строку не разобрать: она не JSON или у неё не тот вид.
 * Печатать такую форматом нечем.
 */
function toEntry(line: string): LogEntry | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  // Остальные ключи идут в том порядке, в каком их написал pino: сперва
  // привязки дочернего логгера, затем поля вызова. Это и есть порядок
  // полей в строке — тот же, что у штатного логгера
  const { time, level, msg, ...fields } = parsed as Record<string, unknown>;

  if (typeof time !== 'string' || !isLevel(level)) {
    return undefined;
  }

  return {
    time,
    level,
    message: typeof msg === 'string' ? msg : undefined,
    fields,
  };
}

/**
 * Создаёт поток назначения для выбранного формата.
 *
 * @param format - Формат строки
 * @returns Поток, который pino отдаёт строку записи
 */
export function makeDestination(format: LogFormat): Destination {
  if (format === 'json') {
    return {
      write(line: string): void {
        process.stderr.write(line);
      },
    };
  }

  return {
    write(line: string): void {
      const entry = toEntry(line);

      // Неразобранная строка уходит как есть: потеря записи хуже, чем
      // строка не того формата
      process.stderr.write(
        entry === undefined ? line : `${formatLine(entry, 'text')}\n`,
      );
    },
  };
}
