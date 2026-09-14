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
import type { Port } from '../ports/index.js';
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

import {
  Component,
  makeSwitch,
  makeToken,
  valueProvider,
} from '@nestlingjs/container';
import { makeRequest } from '@nestlingjs/operations';
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

/** Операция без реализации в сборке: вызыватель есть, владельца нет */
const LonelyOperation = makeRequest({
  name: 'app.lonely.request',
  output: z.object({ ok: z.boolean() }),
});

const LonelyToken = makeToken<{ port: Port<typeof LonelyOperation> }>('Lonely');

/** Приложение, отказывающее на WIRE: вызов операции доставлять нечем */
const unreachable = makeApp({
  features: [
    makeFeature({
      name: 'lonely',
      providers: [
        {
          provide: LonelyToken,
          useFactory: (port: Port<typeof LonelyOperation>) => ({ port }),
          deps: [LonelyOperation.caller],
        },
      ],
    }),
  ],
  transports: [asTransport()],
});

@Component([])
class Refused {
  constructor() {
    throw new Error('Connection refused by the database.');
  }
}

/** Приложение, отказывающее на INIT: конструктор провайдера бросает */
const refusing = makeApp({
  features: [makeFeature({ name: 'refused', providers: [Refused] })],
  transports: [asTransport()],
});

/**
 * Гоняет вход под маркером и возвращает напечатанное с кодом выхода.
 *
 * `process.exit` подменён броском: продолжать после выхода в тесте
 * нечему, а в бою следующей строки уже не будет.
 */
const asCommand = async (run: () => unknown) => {
  const printed: string[] = [];
  const write = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));

      return true;
    });

  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exited');
  }) as never);

  try {
    await expect(async () => await run()).rejects.toThrow('exited');

    return { printed: printed.join(''), code: exit.mock.calls[0]?.[0] };
  } finally {
    write.mockRestore();
    exit.mockRestore();
  }
};

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

  it('срезанный список остаётся броском `TypeError`', () => {
    // Маркера ещё нет: владеть процессом нечему, и ошибка называет дефект
    // кода точки входа, а не ввод пользователя
    expect(() => argv(['--features', 'users'])).toThrow(TypeError);
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

describe('отказ под маркером — отказ команды', () => {
  it('отказ разбора у `run()` печатает сообщение и завершает процесс кодом 1', async () => {
    const failure = await asCommand(() =>
      app.build(argv(line('--mail', 'carrier-pigeon'))).run(),
    );

    expect(failure.code).toBe(1);
    expect(failure.printed).toBe(
      `Error: Switch 'mail' has no value 'carrier-pigeon'. ` +
        `Allowed values: 'log', 'smtp'.\n`,
    );

    // Кадры стека адресованы автору фреймворка, а текст читает автор
    // приложения
    expect(failure.printed).not.toMatch(/\n\s+at /);
  });

  it('неизвестный флаг завершает `discover` тем же исходом', async () => {
    const failure = await asCommand(() =>
      app.discover(argv(line('--featurs', 'users'))),
    );

    expect(failure.code).toBe(1);
    expect(failure.printed).toContain("Unknown flag '--featurs'");
    expect(failure.printed).not.toMatch(/\n\s+at /);
  });

  it('неизвестное имя фичи завершает `check` тем же исходом', async () => {
    const failure = await asCommand(() =>
      app.check(argv(line('--features', 'userz'))),
    );

    expect(failure.code).toBe(1);
    expect(failure.printed).toContain("Unknown feature 'userz'");
  });

  it('источники конфига при отказе разбора не поднимаются', async () => {
    makeConfig('argvprobe', { value: z.string().default('unset') });

    let inited = false;
    const probe: ConfigSource = {
      ...objectSource({ ARGVPROBE_VALUE: 'set' }, 'probe'),
      init: () => {
        inited = true;
      },
    };

    const failure = await asCommand(() =>
      app.check(argv(line('--mail', 'carrier-pigeon')), {
        config: [bind(probe)],
      }),
    );

    expect(failure.printed).toContain("Switch 'mail' has no value");
    expect(inited).toBe(false);
  });

  it('отказ фазы WIRE завершает процесс: вызов операции доставлять нечем', async () => {
    const failure = await asCommand(() =>
      unreachable.build(argv(line())).run({ config: [] }),
    );

    expect(failure.code).toBe(1);
    expect(failure.printed).toContain(
      "Operation 'app.lonely.request' (kind 'request') is injected",
    );
  });

  it('отказ фазы INIT завершает процесс: конструктор провайдера бросает', async () => {
    const failure = await asCommand(() =>
      refusing.build(argv(line())).run({ config: [] }),
    );

    expect(failure.code).toBe(1);
    expect(failure.printed).toContain('Connection refused by the database.');
  });
});

describe('объектная форма аргумента', () => {
  it('отдаёт отказ вызывающему: процесс жив, в stderr ничего нет', async () => {
    const printed: string[] = [];
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: unknown) => {
        printed.push(String(chunk));

        return true;
      });

    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    try {
      await expect(
        app.build({ mail: 'carrier-pigeon' } as never).run(),
      ).rejects.toThrow(/Switch 'mail' has no value "carrier-pigeon"/);

      expect(exit).not.toHaveBeenCalled();
      expect(printed).toEqual([]);
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
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
