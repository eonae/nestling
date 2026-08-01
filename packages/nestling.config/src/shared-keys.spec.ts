/**
 * Общий ключ: право читать ≠ владение. Независимая валидация каждой секцией,
 * единственный конфликт — несогласованный `reloadable`, и он считается в
 * границах одной сборки.
 */

import { from } from './declaration.js';
import { ConfigSharedKeyError, ConfigValidationError } from './errors.js';
import type { Config } from './families.js';
import { configKernel } from './kernel.js';
import { describeConfig } from './registry.js';
import { makeConfig } from './section.js';
import { objectSource } from './source.js';

import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder, Injectable } from '@nestling/container';
import { z } from 'zod';

const warnings: string[] = [];
const onWarn = (message: string): void => {
  warnings.push(message);
};

/** Два законных взгляда на один ключ: число и строка. */
const OrdersConfig = makeConfig('orders', {
  port: from('PORT', z.coerce.number()),
});

const AdminConfig = makeConfig('admin', {
  port: from('PORT', z.string()),
});

/** Тот же ключ, читаемый reloadable-секцией и обычной. */
const RuntimeConfig = makeConfig.reloadable('runtime', {
  dbUrl: from('DATABASE_URL', z.string()),
});

const BillingConfig = makeConfig('billing', {
  databaseUrl: from('DATABASE_URL', z.string()),
});

const HotConfig = makeConfig.reloadable('hot', {
  dbUrl: from('DATABASE_URL', z.string()),
});

@Injectable([OrdersConfig])
class OrdersService {
  constructor(readonly cfg: Config<typeof OrdersConfig>) {}
}

@Injectable([AdminConfig])
class AdminService {
  constructor(readonly cfg: Config<typeof AdminConfig>) {}
}

@Injectable([RuntimeConfig])
class RuntimeService {
  constructor(readonly cfg: Config<typeof RuntimeConfig>) {}
}

@Injectable([BillingConfig])
class BillingService {
  constructor(readonly cfg: Config<typeof BillingConfig>) {}
}

@Injectable([HotConfig])
class HotService {
  constructor(readonly cfg: Config<typeof HotConfig>) {}
}

const build = async (
  values: Record<string, unknown>,
  register: (builder: ContainerBuilder) => void,
): Promise<BuiltContainer> => {
  const builder = new ContainerBuilder();
  builder.register(
    configKernel([[objectSource(values, 'test'), '*']], { onWarn }),
  );
  register(builder);

  return await builder.build();
};

/** Ловит отказ сборки, оставляя тип ошибки конкретным. */
const buildFailure = async <E extends Error>(
  values: Record<string, unknown>,
  register: (builder: ContainerBuilder) => void,
): Promise<E> => {
  try {
    await build(values, register);
  } catch (error) {
    return error as E;
  }

  throw new Error('build() succeeded, expected a failure');
};

beforeEach(() => {
  warnings.length = 0;
});

describe('ключ — разделяемый read-only ресурс', () => {
  it('две секции читают ключ своими схемами, и обе проекции валидны', async () => {
    const container = await build({ PORT: '8080' }, (builder) => {
      builder.register(OrdersService);
      builder.register(AdminService);
    });

    expect(container.getOrThrow(OrdersService).cfg.port).toBe(8080);
    expect(container.getOrThrow(AdminService).cfg.port).toBe('8080');
  });

  it('второй читатель объявляется без ведома первого — «ключ занят» не бывает', () => {
    expect(() =>
      makeConfig('latecomer', { port: from('PORT', z.string()) }),
    ).not.toThrow();
  });

  it('отказ у одного читателя роняет сборку, называя его секцию и ключ', async () => {
    const failure = await buildFailure<ConfigValidationError>(
      { PORT: 'not-a-number' },
      (builder) => {
        builder.register(OrdersService);
        builder.register(AdminService);
      },
    );

    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect(failure.section).toBe('orders');
    expect(failure.failures.map((item) => item.key)).toEqual(['PORT']);
  });
});

describe('согласованность `reloadable` на общем ключе', () => {
  it('reloadable и обычная секция на одном ключе роняют сборку', async () => {
    const failure = await buildFailure<ConfigSharedKeyError>(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(RuntimeService);
        builder.register(BillingService);
      },
    );

    expect(failure).toBeInstanceOf(ConfigSharedKeyError);
    expect(failure.key).toBe('DATABASE_URL');
  });

  it('текст называет обе секции, оба поля и обе починки', async () => {
    const failure = await buildFailure<ConfigSharedKeyError>(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(BillingService);
        builder.register(RuntimeService);
      },
    );

    expect(failure.message).toContain(
      "section 'billing' (field 'databaseUrl')",
    );
    expect(failure.message).toContain("section 'runtime' (field 'dbUrl')");
    expect(failure.message).toContain(
      "declare 'billing' with makeConfig.reloadable",
    );
    expect(failure.message).toContain(
      "drop makeConfig.reloadable from 'runtime'",
    );
  });

  it('текст симметричен: порядок материализации на него не влияет', async () => {
    const first = await buildFailure<ConfigSharedKeyError>(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(RuntimeService);
        builder.register(BillingService);
      },
    );
    const second = await buildFailure<ConfigSharedKeyError>(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(BillingService);
        builder.register(RuntimeService);
      },
    );

    expect(first.message).toBe(second.message);
  });

  it('согласованный reloadable конфликта не даёт', async () => {
    const container = await build(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(RuntimeService);
        builder.register(HotService);
      },
    );

    expect(container.getOrThrow(RuntimeService).cfg.dbUrl).toBe('postgres://x');
    expect(container.getOrThrow(HotService).cfg.dbUrl).toBe('postgres://x');
  });

  it('непотреблённая конфликтующая секция сборку не роняет', async () => {
    const container = await build(
      { DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register(RuntimeService);
      },
    );

    expect(container.getOrThrow(RuntimeService).cfg.dbUrl).toBe('postgres://x');
    // Конфликтующее объявление никуда не делось — оно просто не попало в
    // выбранную топологию, и потому конфликта не создаёт.
    expect(
      describeConfig()
        .keys.find((item) => item.key === 'DATABASE_URL')
        ?.readers.map((reader) => reader.section),
    ).toContain('billing');
  });

  it('две сборки в одном процессе независимы: состояние живёт на читалке', async () => {
    const first = await build({ DATABASE_URL: 'postgres://x' }, (builder) => {
      builder.register(RuntimeService);
    });
    const second = await build({ DATABASE_URL: 'postgres://y' }, (builder) => {
      builder.register(BillingService);
    });

    expect(first.getOrThrow(RuntimeService).cfg.dbUrl).toBe('postgres://x');
    expect(second.getOrThrow(BillingService).cfg.databaseUrl).toBe(
      'postgres://y',
    );
  });
});

describe('читатели ключа в интроспекции', () => {
  it('запись общего ключа перечисляет обе секции с именами полей', () => {
    const entry = describeConfig().keys.find(
      (item) => item.key === 'DATABASE_URL',
    );

    expect(
      entry?.readers.map((reader) => [
        reader.section,
        reader.field,
        reader.reloadable,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['runtime', 'dbUrl', true],
        ['billing', 'databaseUrl', false],
        ['hot', 'dbUrl', true],
      ]),
    );
  });
});
