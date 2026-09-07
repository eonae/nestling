/**
 * Вычисляемое поле: объявление, момент вычисления, секретность, пересчёт
 * при перезагрузке и место в снимке реестра.
 */

import { inspect } from 'node:util';

import type { SpyLogger } from '../logger/__fixtures__/spy.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';

import type { SectionDeclaration } from './declaration.js';
import { from, secret } from './declaration.js';
import { ConfigDerivedError, ConfigValidationError } from './errors.js';
import type { Config } from './families.js';
import { load } from './load.js';
import { projectSection } from './project.js';
import { ConfigReader } from './reader.js';
import { SECRET_MASK } from './redact.js';
import type { ConfigSectionDescription } from './registry.js';
import { describeConfig, lookupSection } from './registry.js';
import { makeConfig } from './section.js';
import type { ObjectSource } from './source.js';
import { objectSource } from './source.js';

import { jest } from '@jest/globals';
import type { SchemaDocConverter } from '@nestling/operations';
import { z } from 'zod';

const PgConfig = makeConfig(
  'pg',
  {
    host: z.string().default('localhost'),
    port: z.coerce.number().int().default(5432),
    user: z.string().default('app'),
    password: secret(z.string()),
  },
  (derived) => ({
    url: derived(
      ['host', 'port', 'user', 'password'],
      (host, port, user, password) =>
        `postgresql://${user}:${password}@${host}:${port}/app`,
    ),
  }),
);

type PgValues = Config<typeof PgConfig>;

/** Шпион логгера: предупреждения читалки попадают сюда после `attachLogger` */
let spy: SpyLogger = spyLogger();

/** Сообщения предупреждений в порядке записи */
const warnings = (): string[] => spy.entries.map((entry) => entry.message);

/** Поднимает читалку с одним объектным источником и проецирует секцию. */
const project = async <Values>(
  prefix: string,
  values: Record<string, unknown>,
): Promise<{ cfg: Values; source: ObjectSource }> => {
  const source = objectSource(values, 'test');
  const reader = new ConfigReader([[source, '*']]);
  await reader.init();
  reader.attachLogger(spy.logger);

  const declaration = lookupSection(prefix) as SectionDeclaration;

  return { cfg: projectSection(declaration, reader) as Values, source };
};

/** Даёт микрозадачам подписки прокрутиться. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  spy = spyLogger();
});

describe('объявление вычисляемого поля', () => {
  it('ключа у поля нет: `.keys` перечисляет только поля рекорда', () => {
    expect(PgConfig.keys.names).toEqual([
      'PG_HOST',
      'PG_PORT',
      'PG_USER',
      'PG_PASSWORD',
    ]);
  });

  it('проекция несёт вычисленное значение после полей рекорда', async () => {
    const { cfg } = await project<PgValues>('pg', {
      PG_HOST: 'db.internal',
      PG_PORT: '6432',
      PG_PASSWORD: 'hunter2',
    });

    expect(cfg.url).toBe('postgresql://app:hunter2@db.internal:6432/app');
    expect(Object.keys(cfg)).toEqual([
      'host',
      'port',
      'user',
      'password',
      'url',
    ]);
  });

  it('имя, занятое полем рекорда, отвергается с именем секции и поля', () => {
    expect(() =>
      makeConfig('collision', { host: z.string() }, (derived) => ({
        host: derived(['host'], (host) => host),
      })),
    ).toThrow(
      /Config section 'collision' declares a derived field named 'host'/,
    );
  });

  it('имя `onChange` у reloadable-секции отвергается на объявлении', () => {
    expect(() =>
      makeConfig.reloadable(
        'collidesderived',
        { rps: z.coerce.number().default(1) },
        (derived) => ({ onChange: derived(['rps'], (rps) => rps) }),
      ),
    ).toThrow(/'onChange'/);
  });
});

describe('момент вычисления', () => {
  it('невалидное поле отменяет вычисление', async () => {
    const compute = jest.fn((token: string) => token.toUpperCase());

    makeConfig('required', { token: z.string() }, (derived) => ({
      upper: derived(['token'], compute),
    }));

    await expect(project('required', {})).rejects.toThrow(
      ConfigValidationError,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('ошибка функции называет секцию, поле и зависимости', async () => {
    const cause = new Error('bad host');

    makeConfig(
      'broken',
      { host: z.string().default('localhost') },
      (derived) => ({
        upper: derived(['host'], () => {
          throw cause;
        }),
      }),
    );

    const failure = (await project('broken', {}).catch(
      (error: unknown) => error,
    )) as ConfigDerivedError;

    expect(failure).toBeInstanceOf(ConfigDerivedError);
    expect(failure.section).toBe('broken');
    expect(failure.field).toBe('upper');
    expect(failure.deps).toEqual(['host']);
    expect(failure.cause).toBe(cause);
    expect(failure.message).toContain("section 'broken'");
    expect(failure.message).toContain("'upper'");
    expect(failure.message).toContain('host');
  });

  it('первичное чтение `load()` считает вычисляемые поля', () => {
    const BootConfig = makeConfig(
      'boot',
      { features: z.string().default('all') },
      (derived) => ({
        upper: derived(['features'], (features) => features.toUpperCase()),
      }),
    );

    process.env.BOOT_FEATURES = 'users,orders';

    expect(load(BootConfig).upper).toBe('USERS,ORDERS');

    delete process.env.BOOT_FEATURES;
  });
});

describe('секретность вычисляемого поля', () => {
  it('маска стоит в `toJSON()` и в `inspect`, чтение отдаёт значение', async () => {
    const { cfg } = await project<PgValues>('pg', {
      PG_HOST: 'db.internal',
      PG_PASSWORD: 'hunter2',
    });

    expect(JSON.stringify(cfg)).toContain(
      JSON.stringify({ url: SECRET_MASK }).slice(1, -1),
    );
    expect(JSON.stringify(cfg)).not.toContain('hunter2');
    expect(inspect(cfg)).not.toContain('hunter2');
    expect(cfg.url).toContain('hunter2');
  });

  it('поле без секретных зависимостей печатается как есть', async () => {
    makeConfig(
      'plainderived',
      {
        host: z.string().default('localhost'),
        port: z.coerce.number().int().default(80),
      },
      (derived) => ({
        address: derived(['host', 'port'], (host, port) => `${host}:${port}`),
      }),
    );

    const { cfg } = await project<{ address: string }>('plainderived', {});

    expect(JSON.stringify(cfg)).toContain('"address":"localhost:80"');
  });

  it('секретность приходит от чужого объявления ключа', async () => {
    makeConfig('borrower', {
      shared: from('SHARED_SECRET', z.string().default('x')),
    });

    makeConfig(
      'borrowerreader',
      { shared: from('SHARED_SECRET', z.string().default('x')) },
      (derived) => ({
        upper: derived(['shared'], (shared) => shared.toUpperCase()),
      }),
    );

    // Пометку ставит **другая** секция, объявленная позже
    makeConfig('marker', {
      shared: secret(from('SHARED_SECRET', z.string().default('x'))),
    });

    const { cfg } = await project<{ upper: string }>('borrowerreader', {
      SHARED_SECRET: 'value',
    });

    expect(JSON.stringify(cfg)).toContain(`"upper":"${SECRET_MASK}"`);
    expect(cfg.upper).toBe('VALUE');
  });
});

/**
 * Проекция reloadable-секции записана вручную, а не выведена из
 * `Config<typeof …>`: типы вычисляемого поля проверяет
 * `derived.type-test.ts`, а здесь важно только поведение в рантайме.
 */
interface HotValues {
  readonly rps: number;
  readonly note: string;
  readonly perMinute: number;
}

interface FragileValues {
  readonly rps: number;
  readonly doubled: number;
  onChange(signal: AbortSignal, callback: (next: FragileValues) => void): void;
}

describe('пересчёт при перезагрузке', () => {
  const compute = jest.fn((rps: number) => rps * 60);

  makeConfig.reloadable(
    'hot',
    {
      rps: z.coerce.number().default(100),
      note: z.string().default('none'),
    },
    (derived) => ({ perMinute: derived(['rps'], compute) }),
  );

  beforeEach(() => {
    compute.mockClear();
  });

  it('изменившаяся зависимость даёт новое значение', async () => {
    const { cfg, source } = await project<HotValues>('hot', {
      HOT_RPS: '10',
    });

    expect(cfg.perMinute).toBe(600);

    source.set('HOT_RPS', '20');
    await settle();

    expect(cfg.perMinute).toBe(1200);
  });

  it('совпавшие зависимости не вызывают функцию поля', async () => {
    const { source } = await project<HotValues>('hot', { HOT_RPS: '10' });

    expect(compute).toHaveBeenCalledTimes(1);

    source.set('HOT_NOTE', 'changed');
    await settle();

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('ошибка функции оставляет последний валидный снапшот', async () => {
    makeConfig.reloadable(
      'fragile',
      { rps: z.coerce.number().default(1) },
      (derived) => ({
        doubled: derived(['rps'], (rps) => {
          if (rps > 100) {
            throw new Error('too many');
          }

          return rps * 2;
        }),
      }),
    );

    const seen: number[] = [];
    const { cfg, source } = await project<FragileValues>('fragile', {
      FRAGILE_RPS: '10',
    });

    cfg.onChange(new AbortController().signal, (next) => {
      seen.push(next.doubled);
    });

    source.set('FRAGILE_RPS', '1000');
    await settle();

    expect(cfg.rps).toBe(10);
    expect(cfg.doubled).toBe(20);
    expect(seen).toEqual([]);
    expect(warnings().join('\n')).toContain(
      "keeping last known good values of reloadable config section 'fragile'",
    );
  });
});

/** Конвертер zod — тот же, что принимает генерация OpenAPI */
const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

/** Описание секции из снимка, снятого с конвертерами или без них */
const sectionOf = (
  prefix: string,
  converters?: readonly SchemaDocConverter[],
): ConfigSectionDescription | undefined =>
  describeConfig(converters ? { converters } : undefined).sections.find(
    (section) => section.prefix === prefix,
  );

describe('снимок реестра', () => {
  it('вычисляемое поле стоит отдельным перечнем, а не среди ключей', () => {
    const section = sectionOf('pg');

    expect(section?.derived).toEqual([
      {
        field: 'url',
        deps: ['host', 'port', 'user', 'password'],
        secret: true,
      },
    ]);
    expect(section?.keys.map((key) => key.field)).toEqual([
      'host',
      'port',
      'user',
      'password',
    ]);
  });

  it('описание и умолчание приходят из JSON Schema конвертера', () => {
    makeConfig('documented', {
      pageSize: z.coerce
        .number()
        .default(20)
        .describe('Размер страницы списка'),
    });

    const key = sectionOf('documented', [zodConverter()])?.keys[0];

    expect(key?.schema?.outcome).toBe('converted');
    expect(key?.schema).toMatchObject({
      vendor: 'zod',
      json: { description: 'Размер страницы списка', default: 20 },
    });
  });

  it('конвертера для вендора нет — исход назван, схемы нет', () => {
    const key = sectionOf('documented', [
      { vendor: 'other', toJsonSchema: () => ({}) },
    ])?.keys[0];

    expect(key?.schema).toEqual({ outcome: 'unconvertible', vendor: 'zod' });
  });

  it('без конвертеров полей JSON Schema в снимке нет', () => {
    const key = sectionOf('documented')?.keys[0];

    expect(key).toEqual({
      key: 'DOCUMENTED_PAGE_SIZE',
      field: 'pageSize',
      exact: false,
      secret: false,
    });
  });

  it('секция без вычисляемых полей несёт пустой перечень', () => {
    expect(sectionOf('documented')?.derived).toEqual([]);
  });
});
