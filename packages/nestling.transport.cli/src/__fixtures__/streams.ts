/**
 * Потоки для тестов транспорта: подставляются опциями `cli({ … })`.
 *
 * Терминала в тесте нет, и подменять глобальные каналы процесса не нужно:
 * транспорт читает и пишет ровно те потоки, которые ему передали.
 */

import { Readable, Writable } from 'node:stream';

/** Поток вывода, копящий записанное строками */
export interface Sink extends Writable {
  /** Всё записанное одной строкой */
  readonly text: string;
}

/** Создаёт поток вывода, копящий записанное в памяти */
export function sink(): Sink {
  const chunks: string[] = [];

  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      callback();
    },
  });

  Object.defineProperty(stream, 'text', {
    get: () => chunks.join(''),
  });

  return stream as Sink;
}

/**
 * Создаёт поток ввода из готового текста.
 *
 * Ответы на вопросы передаются строками: readline читает их по одной, как
 * читал бы набранные в терминале.
 */
export function source(...lines: readonly string[]): Readable {
  return Readable.from(lines.map((line) => Buffer.from(line)));
}
