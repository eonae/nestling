/**
 * Маркер `argv` как аргумент сборки.
 *
 * Проверяется то, ради чего маркер заведён: командную строку разбирает
 * декларация, состав от него не отличается от состава объектной формы, а
 * отказ случается до фазы 0 — до любого ввода-вывода.
 */

import { objectSource } from '../config/__fixtures__/object-source.js';
import type { ConfigSource } from '../config/index.js';
import { bind, makeConfig } from '../config/index.js';
import { Ok } from '../pipeline/index.js';
import { transportValue } from '../transport/index.js';

import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { argv, isArgv } from './argv.js';
import { makeFeature } from './feature.js';
import { MockTransport } from './helpers.js';

import { makeSwitch, makeToken, valueProvider } from '@nestlingjs/container';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const Mail = makeSwitch('mail', ['log', 'smtp'], { default: 'log' });

const ping = (path: string) =>
  testEndpoint({
    method: 'GET',
    path,
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

const Mail$ = makeToken<string>('Mail');

const UsersFeature = makeFeature({
  name: 'users',
  endpoints: [ping('/users')],
  providers: [
    Mail.pick({
      log: [valueProvider(Mail$, 'log')],
      smtp: [valueProvider(Mail$, 'smtp')],
    }),
  ],
});

const NotificationsFeature = makeFeature({
  name: 'notifications',
  endpoints: [ping('/notifications')],
});

const asTransport = () =>
  transportValue(TestTransport$('default'), new MockTransport(), {
    capabilities: ALL_FORMS,
  });

const app = makeApp({
  features: [UsersFeature, NotificationsFeature],
  switches: [Mail],
  transports: [asTransport()],
});

/** Командная строка процесса: путь к node, путь к скрипту и флаги */
const line = (...flags: string[]) => [
  '/usr/bin/node',
  '/app/main.js',
  ...flags,
];

/** Паттерны состава — по ним сверяются формы аргумента */
const patterns = (...args: Parameters<typeof app.discover>) =>
  app
    .discover(...args)
    .endpoints.map(({ endpoint }) => endpoint.pattern)
    .sort();

describe('маркер командной строки', () => {
  it('несёт список целиком и ничего не разбирает', () => {
    const marker = argv(line('--unknown'));

    expect(marker.strings).toEqual(line('--unknown'));
    expect(isArgv(marker)).toBe(true);
  });

  it('замораживает и себя, и список', () => {
    const marker = argv(line());

    expect(Object.isFrozen(marker)).toBe(true);
    expect(Object.isFrozen(marker.strings)).toBe(true);
  });

  it('срезанный список отвергается с правильной формой в сообщении', () => {
    expect(() => argv(['--features', 'users'])).toThrow(
      /argv\(process\.argv\)/,
    );
  });

  it('объектную форму маркером не считают', () => {
    expect(isArgv({ features: 'users' })).toBe(false);
  });
});

describe('состав по маркеру', () => {
  it('совпадает с составом объектной формы', () => {
    expect(patterns(argv(line('--features', 'users')))).toEqual(
      patterns({ features: 'users' }),
    );
  });

  it('пустая командная строка выбирает всё — как вызов без аргумента', () => {
    expect(patterns(argv(line()))).toEqual(patterns());
  });

  it('флаг замыкания делает то же, что поле объектной формы', () => {
    expect(
      patterns(argv(line('--features', 'users', '--include-deps'))),
    ).toEqual(patterns({ features: 'users', includeDeps: true }));
  });

  it('значение переключателя приходит в раскрытие веток', async () => {
    const report = await app.check(argv(line('--mail', 'smtp')));

    expect(report.switches).toEqual({ mail: 'smtp' });
  });

  it('маркер разбирают все три входа согласованно', async () => {
    const marker = argv(line('--features', 'users', '--mail', 'smtp'));

    const report = await app.check(marker);

    // `build` разбора не делает — его выполняет `run()`; сверяются два
    // входа, которые разбирают аргумент сами
    expect(report.features).toEqual(['users']);
    expect(report.switches).toEqual({ mail: 'smtp' });
    expect(report.endpoints.map(({ pattern }) => pattern).sort()).toEqual(
      patterns(marker),
    );
  });
});

describe('отказ разбора — до фазы 0', () => {
  it('неизвестный флаг роняет `discover`', () => {
    expect(() => app.discover(argv(line('--featurs', 'users')))).toThrow(
      /Unknown flag '--featurs'/,
    );
  });

  it('неизвестное имя фичи ловит разрешение выбора', () => {
    expect(() => app.discover(argv(line('--features', 'userz')))).toThrow(
      /Unknown feature 'userz'/,
    );
  });

  it('источники конфига при отказе не поднимаются', async () => {
    makeConfig('argvprobe', { value: z.string().default('unset') });

    let inited = false;
    const probe: ConfigSource = {
      ...objectSource({ ARGVPROBE_VALUE: 'set' }, 'probe'),
      init: () => {
        inited = true;
      },
    };

    await expect(
      app.check(argv(line('--mail', 'carrier-pigeon')), {
        config: [bind(probe)],
      }),
    ).rejects.toThrow(/Switch 'mail' has no value 'carrier-pigeon'/);

    expect(inited).toBe(false);
  });
});

describe('`--help` печатает схему и завершает процесс', () => {
  it('схема уходит в stdout, процесс завершается кодом 0, состав не считается', () => {
    const printed: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown) => {
        printed.push(String(chunk));

        return true;
      });

    // Выход прерывает разбор броском: продолжать после `process.exit` в
    // тесте нечему, а в бою следующей строки уже не будет
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    try {
      expect(() => app.discover(argv(line('--help')))).toThrow('exited');

      expect(exit).toHaveBeenCalledWith(0);
      expect(printed.join('')).toContain('Usage: node /app/main.js [options]');
      expect(printed.join('')).toContain('Features: users, notifications');
      expect(printed.join('')).toContain('--mail <log|smtp>');
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });
});
