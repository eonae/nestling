/**
 * Отказ под маркером `argv(…)`: текст отказа, печать и выход процесса.
 *
 * Вход, получивший маркер, завершает процесс сам — и справкой, и отказом.
 * Справку печатает `parseArgs`, отказ — этот модуль.
 *
 * Текст строит чистая `failureText`: тест читает его целиком, не завершая
 * процесса. Печать в `stderr` и выход кодом `1` стоят отдельно, в
 * `failAsCommand`. Обрамления `underArgv` и `underArgvAsync` зовут границу
 * за входы декларации: `build(args).run()`, `discover(args)` и
 * `check(args, options?)`.
 */

import type { BuildArgs } from './args.js';
import { isArgv } from './argv.js';

/** Отступ одного уровня цепочки причин */
const INDENT = '  ';

/** Строка уровня: имя ошибки с сообщением либо значение как есть */
const lineOf = (value: unknown): string =>
  value instanceof Error ? `${value.name}: ${value.message}` : String(value);

/** Причины ошибки: список `AggregateError` вширь, затем `cause` вглубь */
const causesOf = (error: Error): readonly unknown[] => [
  ...(error instanceof AggregateError ? (error.errors as unknown[]) : []),
  ...(error.cause === undefined ? [] : [error.cause]),
];

/**
 * Дописывает строку уровня и спускается по его причинам.
 *
 * Посещённые ошибки запоминаются: ошибка, названная причиной самой себя,
 * иначе развернулась бы бесконечно.
 */
function appendLevel(
  value: unknown,
  depth: number,
  seen: Set<unknown>,
  lines: string[],
): void {
  if (value instanceof Error) {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
  }

  lines.push(
    depth === 0
      ? lineOf(value)
      : `${INDENT.repeat(depth)}caused by: ${lineOf(value)}`,
  );

  if (value instanceof Error) {
    for (const cause of causesOf(value)) {
      appendLevel(cause, depth + 1, seen, lines);
    }
  }
}

/**
 * Строит текст отказа: сообщение и цепочка причин под ним.
 *
 * Каждый уровень цепочки занимает свою строку с отступом. Значение, не
 * являющееся `Error`, приходит в текст своим строковым представлением.
 *
 * Функция чистая: она ничего не печатает и процесс не завершает. Стека в
 * тексте нет — кадры адресованы автору фреймворка, а текст читает автор
 * приложения.
 *
 * @param error - Отказ разбора командной строки либо отказ фазы
 * @returns Готовый текст с завершающим переводом строки
 */
export function failureText(error: unknown): string {
  const lines: string[] = [];

  appendLevel(error, 0, new Set(), lines);

  return `${lines.join('\n')}\n`;
}

/**
 * Печатает текст отказа в `stderr` и завершает процесс кодом `1`.
 *
 * @param error - Отказ, пришедший от входа под маркером
 * @returns Не возвращает: процесс завершён
 */
export function failAsCommand(error: unknown): never {
  process.stderr.write(failureText(error));

  // Выход процесса — поведение командной строки, а не библиотеки: отказ
  // команды печатает сообщение и завершает процесс. Выход немедленный, а
  // не присвоение `exitCode`: захваченный на INIT сокет или живой таймер
  // держали бы процесс, отказавшийся подниматься
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

/**
 * Проводит синхронный вход декларации под правилом маркера.
 *
 * Аргумент является маркером — отказ становится отказом команды:
 * сообщение в `stderr` и код выхода `1`. Иначе вызов проходит насквозь, и
 * отказ остаётся броском.
 *
 * @param args - Аргумент сборки в любой форме
 * @param run - Тело входа
 * @returns Значение тела
 */
export function underArgv<T>(
  args: BuildArgs<any> | undefined,
  run: () => T,
): T {
  if (!isArgv(args)) {
    return run();
  }

  try {
    return run();
  } catch (error) {
    failAsCommand(error);
  }
}

/**
 * Проводит асинхронный вход декларации под правилом маркера.
 *
 * Правило то же, что у {@link underArgv}: маркер превращает отказ в отказ
 * команды, объектная форма оставляет промис отклонённым.
 *
 * @param args - Аргумент сборки в любой форме
 * @param run - Тело входа
 * @returns Значение тела
 */
export async function underArgvAsync<T>(
  args: BuildArgs<any> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!isArgv(args)) {
    return await run();
  }

  try {
    return await run();
  } catch (error) {
    failAsCommand(error);
  }
}
