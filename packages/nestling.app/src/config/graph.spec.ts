/**
 * Секция как узел графа: создаётся при инжекте, участвует в топологическом
 * порядке сборки, проходит fail-fast валидацию в `build()`.
 */

import { from } from './declaration.js';
import { ConfigValidationError } from './errors.js';
import { Config } from './families.js';
import { configKernel } from './kernel.js';
import { describeConfig } from './registry.js';
import { makeConfig } from './section.js';
import { objectSource } from './source.js';

import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder, Injectable, makeToken } from '@nestling/container';
import { z } from 'zod';

const warnings: string[] = [];
const onWarn = (message: string): void => {
  warnings.push(message);
};

const OrdersConfig = makeConfig('orders', {
  maxItems: z.coerce.number().default(100),
  databaseUrl: from('DATABASE_URL', z.string()),
});

const LonelyConfig = makeConfig('lonely', { value: z.string().optional() });

@Injectable([OrdersConfig])
class OrdersService {
  constructor(readonly cfg: Config<typeof OrdersConfig>) {}
}

/** Ловит отказ сборки, оставляя тип ошибки конкретным. */
const buildFailure = async (
  values: Record<string, unknown>,
  register?: (builder: ContainerBuilder) => void,
): Promise<ConfigValidationError> => {
  try {
    await build(values, register);
  } catch (error) {
    return error as ConfigValidationError;
  }

  throw new Error('build() succeeded, expected ConfigValidationError');
};

const build = async (
  values: Record<string, unknown>,
  register: (builder: ContainerBuilder) => void = (builder) => {
    builder.register(OrdersService);
  },
): Promise<BuiltContainer> => {
  const builder = new ContainerBuilder();
  builder.register(
    configKernel([[objectSource(values, 'test'), '*']], { onWarn }),
  );
  register(builder);

  return await builder.build();
};

beforeEach(() => {
  warnings.length = 0;
});

describe('создание секции', () => {
  it('инжект секции создаёт узел, видимый контейнеру', async () => {
    const container = await build({
      ORDERS_MAX_ITEMS: '7',
      DATABASE_URL: 'postgres://x',
    });

    const service = container.getOrThrow(OrdersService);

    expect(service.cfg).toEqual({ maxItems: 7, databaseUrl: 'postgres://x' });
    expect(container.getOrThrow(OrdersConfig)).toBe(service.cfg);
  });

  it('узел неотличим от обычного: он есть в графе и в его метаданных', async () => {
    const container = await build({ DATABASE_URL: 'postgres://x' });
    const json = await container.toJSON();

    const node = json.nodes.find((item) => item.id === 'ConfigSection:orders');

    expect(node).toBeDefined();
    expect(node?.metadata.module).toBe('kernel:config');
  });

  it('секция без потребителей в граф не попадает и не читается', async () => {
    const container = await build({ DATABASE_URL: 'postgres://x' });

    expect(container.get(LonelyConfig)).toBeNull();
    expect(
      describeConfig().sections.find((item) => item.prefix === 'lonely')
        ?.consumed,
    ).toBe(false);
  });

  it('потреблённая секция отмечена в снимке реестра', async () => {
    await build({ DATABASE_URL: 'postgres://x' });

    expect(
      describeConfig().sections.find((item) => item.prefix === 'orders')
        ?.consumed,
    ).toBe(true);
  });

  it('проекция заморожена — присвоить полю нельзя', async () => {
    const container = await build({ DATABASE_URL: 'postgres://x' });
    const cfg = container.getOrThrow(OrdersService).cfg;

    expect(Object.isFrozen(cfg)).toBe(true);
    expect(() => {
      (cfg as { maxItems: number }).maxItems = 1;
    }).toThrow(TypeError);
  });
});

describe('fail-fast на сборке', () => {
  it('невалидное значение роняет build()', async () => {
    await expect(
      build({ ORDERS_MAX_ITEMS: 'abc', DATABASE_URL: 'postgres://x' }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it('называет все проваленные поля разом, а не первое', async () => {
    const ThreeFields = makeConfig('three', {
      alpha: z.coerce.number(),
      beta: z.string(),
      gamma: z.coerce.number(),
    });

    @Injectable([ThreeFields])
    class Consumer {
      constructor(readonly cfg: Config<typeof ThreeFields>) {}
    }

    const failure = await buildFailure(
      { THREE_ALPHA: 'nope', THREE_BETA: 'ok', THREE_GAMMA: 'nope' },
      (builder) => {
        builder.register(Consumer);
      },
    );

    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect(failure.failures.map((item) => item.key)).toEqual([
      'THREE_ALPHA',
      'THREE_GAMMA',
    ]);
    expect(failure.sources).toEqual(['test', 'process.env']);
  });

  it('отсутствующий ключ с `.default()` валиден, обязательный — падает', async () => {
    const container = await build({ DATABASE_URL: 'postgres://x' });
    expect(container.getOrThrow(OrdersService).cfg.maxItems).toBe(100);

    const failure = await buildFailure({});

    expect(failure).toBeInstanceOf(ConfigValidationError);
    expect(failure.failures.map((item) => item.key)).toEqual(['DATABASE_URL']);
    expect(failure.message).toContain('process.env');
  });
});

/** Имя ключа адреса сервера — паттерн on-demand-инфраструктуры */
const addressKey = (server: string): string =>
  `${server.toUpperCase()}_GRPC_ADDRESS`;

describe('семейство одиночных ключей Config(key)', () => {
  const IUsersClient = makeToken<{ address: unknown }>('IUsersClient');

  it('создаётся из deps и разрешается по общим правилам приоритета', async () => {
    const container = await build(
      { USERS_GRPC_ADDRESS: 'users:50051', DATABASE_URL: 'postgres://x' },
      (builder) => {
        builder.register({
          provide: IUsersClient,
          useFactory: (address: unknown) => ({ address }),
          deps: [Config(addressKey('users'))],
        });
      },
    );

    expect(container.getOrThrow(IUsersClient).address).toBe('users:50051');
  });

  it('отдаёт сырое значение, не валидируя его', async () => {
    const container = await build(
      { ANY_KEY: '  not-a-number  ' },
      (builder) => {
        builder.register({
          provide: IUsersClient,
          useFactory: (address: unknown) => ({ address }),
          deps: [Config('ANY_KEY')],
        });
      },
    );

    expect(container.getOrThrow(IUsersClient).address).toBe('  not-a-number  ');
  });
});
