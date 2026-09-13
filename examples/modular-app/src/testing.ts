/**
 * Общее для спек: гейт по базе и конфиг прогона.
 *
 * Приложению нужна настоящая база: пул открывается на фазе INIT, а слой
 * транзакции, хранилище outbox'а и отметки приёма пишут SQL. Адрес
 * приходит переменной `TEST_DATABASE_URL`; без неё прогон пропускается, и
 * `yarn verify` на машине без базы остаётся зелёным. База поднимается
 * локально `yarn db:up` и мигрируется `yarn db:migrate`.
 *
 * Имя переменной своё, а не `DATABASE_URL`: прогон тестов не должен
 * зависеть от того, что лежит в окружении под именем боевого ключа.
 */

import { describe } from '@jest/globals';
import type { ConfigInput } from '@nestlingjs/app';
import { vars } from '@nestlingjs/testing';

/** Адрес базы; без него набор пропускается */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** `describe`, который молчит без базы */
export const describeWithDatabase: (title: string, suite: () => void) => void =
  TEST_DATABASE_URL ? describe : describe.skip;

/** Конфиг теста: объект вместо `process.env` */
export const testConfig: ConfigInput = vars({
  DATABASE_URL: TEST_DATABASE_URL ?? '',
});

/**
 * Ждёт, пока условие станет истинным.
 *
 * Доставка шины асинхронна: `publish` кладёт сообщение в тему, а
 * подписчик разбирает её отдельной задачей. Проверять его след сразу
 * после прохода relay — гонка, и слой транзакции подписчика делает её
 * заметной: открытие транзакции уходит за границу микротасков.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`не дождались: ${what}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Сколько раз запись с этим сообщением попала в логгер */
export const countOf = (
  entries: readonly { message: string }[],
  message: string,
): number => entries.filter((entry) => entry.message === message).length;
