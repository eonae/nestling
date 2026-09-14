/**
 * Текст отказа и граница выхода.
 *
 * Текст строит чистая функция, поэтому тест читает его целиком, не
 * завершая процесса. Печать и выход проверяются отдельно, под моком
 * `process.exit`.
 */

import { argv } from './argv.js';
import {
  failAsCommand,
  failureText,
  underArgv,
  underArgvAsync,
} from './command-exit.js';

import { describe, expect, it, vi } from 'vitest';

/** Командная строка процесса: путь к node, путь к скрипту и флаги */
const line = (...flags: string[]) => [
  '/usr/bin/node',
  '/app/main.js',
  ...flags,
];

describe('текст отказа', () => {
  it('называет ошибку именем и сообщением', () => {
    expect(failureText(new Error('Switch mail has no value.'))).toBe(
      'Error: Switch mail has no value.\n',
    );
  });

  it('разворачивает цепочку `cause` вглубь, по строке на уровень', () => {
    const root = new Error('MAIL_SMTP_HOST is required.');
    const section = new Error("Config section 'mail' failed to load.", {
      cause: root,
    });

    expect(failureText(new Error('Provider failed.', { cause: section }))).toBe(
      [
        'Error: Provider failed.',
        "  caused by: Error: Config section 'mail' failed to load.",
        '    caused by: Error: MAIL_SMTP_HOST is required.',
        '',
      ].join('\n'),
    );
  });

  it('разворачивает `AggregateError` вширь, по строке на ошибку', () => {
    const failure = new AggregateError(
      [new Error('First source is silent.'), new Error('Second one too.')],
      'No source answered.',
    );

    expect(failureText(failure)).toBe(
      [
        'AggregateError: No source answered.',
        '  caused by: Error: First source is silent.',
        '  caused by: Error: Second one too.',
        '',
      ].join('\n'),
    );
  });

  it('обрывает цикл в цепочке причин', () => {
    const looped = new Error('Loops onto itself.');
    looped.cause = looped;

    expect(failureText(looped)).toBe('Error: Loops onto itself.\n');
  });

  it('печатает значение, не являющееся `Error`, его строкой', () => {
    expect(failureText('plain string')).toBe('plain string\n');
    expect(failureText(new Error('Threw a string.', { cause: 'why' }))).toBe(
      'Error: Threw a string.\n  caused by: why\n',
    );
  });

  it('стека в тексте нет', () => {
    expect(failureText(new Error('Boom.'))).not.toContain('at ');
  });
});

describe('граница выхода', () => {
  it('печатает текст в stderr и завершает процесс кодом 1', () => {
    const printed: string[] = [];
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: unknown) => {
        printed.push(String(chunk));

        return true;
      });

    // Выход прерывает вызов броском: продолжать после `process.exit` в
    // тесте нечему, а в бою следующей строки уже не будет
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    try {
      expect(() => failAsCommand(new Error('Boom.'))).toThrow('exited');

      expect(exit).toHaveBeenCalledWith(1);
      expect(printed.join('')).toBe('Error: Boom.\n');
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('обрамление входа', () => {
  it('без маркера пропускает значение и бросок насквозь', async () => {
    expect(underArgv({ features: 'users' }, () => 'built')).toBe('built');

    expect(() =>
      underArgv(undefined, () => {
        throw new Error('Boom.');
      }),
    ).toThrow('Boom.');

    await expect(
      underArgvAsync({ features: 'users' }, () =>
        Promise.reject(new Error('Boom.')),
      ),
    ).rejects.toThrow('Boom.');
  });

  it('под маркером отдаёт отказ границе выхода', async () => {
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    try {
      expect(() =>
        underArgv(argv(line()), () => {
          throw new Error('Boom.');
        }),
      ).toThrow('exited');

      await expect(
        underArgvAsync(argv(line()), () => Promise.reject(new Error('Boom.'))),
      ).rejects.toThrow('exited');

      expect(exit).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });
});
