/**
 * Три поверхности редактирования: текст и объект `ConfigValidationError`,
 * печать проекции, снимок реестра. И явная граница гарантии — всё, что
 * фреймворк не печатает сам, он и не редактирует.
 */

import { inspect } from 'node:util';

import type { SpyLogger } from '../logger/__fixtures__/spy.js';
import { spyLogger } from '../logger/__fixtures__/spy.js';

import type { SectionDeclaration } from './declaration.js';
import { from, secret } from './declaration.js';
import { ConfigValidationError, REDACTED } from './errors.js';
import type { Config } from './families.js';
import { bootstrapConfig, configKernel } from './kernel.js';
import { load } from './load.js';
import { projectSection, reloadableOf } from './project.js';
import { ConfigReader } from './reader.js';
import { SECRET_MASK } from './redact.js';
import { describeConfig, lookupSection } from './registry.js';
import { makeConfig } from './section.js';
import type { ObjectSource } from './source.js';
import { objectSource } from './source.js';

import type { BuiltContainer } from '@nestling/container';
import { Component, ContainerBuilder } from '@nestling/container';
import { z } from 'zod';

/** Сообщение вендора, по которому видно утечку значения. */
const leaky = (): z.ZodType<string> =>
  z.string().refine((value) => value.startsWith('sk-'), {
    message: 'token must start with sk-',
  });

const VaultConfig = makeConfig('vault', {
  apiToken: secret(leaky()),
  logLevel: z.string().default('info'),
});

/** Тот же ключ, что у секретного поля `vault`, но объявлен без пометки. */
const MirrorConfig = makeConfig('mirror', {
  token: from('VAULT_API_TOKEN', z.string()),
});

const HotSecretConfig = makeConfig.reloadable('hotsecret', {
  password: secret(z.string().min(3)),
  host: z.string().default('localhost'),
});

const PlainConfig = makeConfig('plain', {
  logLevel: z.string().default('info'),
});

@Component([VaultConfig])
class VaultService {
  constructor(readonly cfg: Config<typeof VaultConfig>) {}
}

@Component([MirrorConfig])
class MirrorService {
  constructor(readonly cfg: Config<typeof MirrorConfig>) {}
}

@Component([PlainConfig])
class PlainService {
  constructor(readonly cfg: Config<typeof PlainConfig>) {}
}

/** Шпион логгера: предупреждения читалки попадают сюда после `attachLogger` */
let spy: SpyLogger = spyLogger();

/** Сообщения предупреждений в порядке записи */
const warnings = (): string[] => spy.entries.map((entry) => entry.message);

const build = async (
  values: Record<string, unknown>,
  register: (builder: ContainerBuilder) => void,
): Promise<BuiltContainer> => {
  const reader = await bootstrapConfig([[objectSource(values, 'test'), '*']]);
  reader.attachLogger(spy.logger);

  const builder = new ContainerBuilder();
  builder.register(configKernel(reader));
  register(builder);

  const container = builder.build();
  await container.init();

  return container;
};

/** Поднимает читалку с одним объектным источником и проецирует секцию. */
const project = async (
  values: Record<string, unknown>,
  prefix: string,
): Promise<{ cfg: Record<string, unknown>; source: ObjectSource }> => {
  const source = objectSource(values, 'test');
  const reader = new ConfigReader([[source, '*']]);
  await reader.init();
  reader.attachLogger(spy.logger);

  const declaration = lookupSection(prefix) as SectionDeclaration;

  return {
    cfg: projectSection(declaration, reader) as Record<string, unknown>,
    source,
  };
};

/**
 * Ловит отказ сборки, оставляя тип ошибки конкретным.
 *
 * Секция — провайдер значения: `build()` вычисляет проекцию сразу, и
 * ошибка секции доходит наружу как есть — рецепт семейства её не
 * оборачивает.
 */
const buildFailure = async (
  values: Record<string, unknown>,
  register: (builder: ContainerBuilder) => void,
): Promise<ConfigValidationError> => {
  try {
    await build(values, register);
  } catch (error) {
    return error as ConfigValidationError;
  }

  throw new Error('build() succeeded, expected ConfigValidationError');
};

beforeEach(() => {
  spy = spyLogger();
});

describe('редактирование в ошибке валидации', () => {
  it('заданное невалидное значение редактируется и в тексте, и в объекте', async () => {
    const failure = await buildFailure(
      { VAULT_API_TOKEN: 'plaintext-password' },
      (builder) => {
        builder.register(VaultService);
      },
    );

    expect(failure.message).toContain('VAULT_API_TOKEN');
    expect(failure.message).toContain("field 'apiToken'");
    expect(failure.message).toContain(REDACTED);
    expect(failure.message).not.toContain('token must start with sk-');

    expect(failure.failures[0]?.redacted).toBe(true);
    expect(failure.failures[0]?.issues[0]?.message).toBe(REDACTED);
  });

  it('незаданный секретный ключ показывается целиком', async () => {
    const failure = await buildFailure({}, (builder) => {
      builder.register(VaultService);
    });

    expect(failure.failures[0]?.redacted).toBe(false);
    expect(failure.message).not.toContain(REDACTED);
    expect(failure.message).toMatch(/expected string, received undefined/i);
  });

  it('секретное и обычное поле попадают в одну ошибку, каждое по-своему', async () => {
    const Mixed = makeConfig('mixed', {
      token: secret(leaky()),
      port: z.coerce.number(),
    });

    @Component([Mixed])
    class MixedService {
      constructor(readonly cfg: Config<typeof Mixed>) {}
    }

    const failure = await buildFailure(
      { MIXED_TOKEN: 'plaintext', MIXED_PORT: 'not-a-number' },
      (builder) => {
        builder.register(MixedService);
      },
    );

    expect(failure.failures.map((item) => [item.key, item.redacted])).toEqual([
      ['MIXED_TOKEN', true],
      ['MIXED_PORT', false],
    ]);
    expect(failure.message).not.toContain('token must start with sk-');
    expect(failure.message).toMatch(/mixed_port.+expected number/is);
  });

  it('эффективная секретность редактирует и чужую секцию на том же ключе', async () => {
    const Strict = makeConfig('strict', {
      token: from('VAULT_API_TOKEN', z.string().min(50)),
    });

    @Component([Strict])
    class StrictService {
      constructor(readonly cfg: Config<typeof Strict>) {}
    }

    const failure = await buildFailure(
      { VAULT_API_TOKEN: 'sk-short' },
      (builder) => {
        builder.register(StrictService);
      },
    );

    expect(failure.section).toBe('strict');
    expect(failure.failures[0]?.redacted).toBe(true);
    expect(failure.failures[0]?.issues[0]?.message).toBe(REDACTED);
  });

  it('редактирование работает и в первичном `load()`', () => {
    process.env.VAULT_API_TOKEN = 'plaintext-password';

    try {
      expect(() => load(VaultConfig)).toThrow(ConfigValidationError);

      let failure: ConfigValidationError | undefined;
      try {
        load(VaultConfig);
      } catch (error) {
        failure = error as ConfigValidationError;
      }

      expect(failure?.failures[0]?.redacted).toBe(true);
      expect(failure?.message).not.toContain('token must start with sk-');
      expect(failure?.message).toContain(REDACTED);
    } finally {
      delete process.env.VAULT_API_TOKEN;
    }
  });

  it('warn о неудачном reload не выносит вендорский текст', async () => {
    const { cfg, source } = await project(
      { HOTSECRET_PASSWORD: 'good' },
      HotSecretConfig.keys.prefix,
    );

    expect(cfg.password).toBe('good');

    source.set('HOTSECRET_PASSWORD', 'no');

    expect(cfg.password).toBe('good');
    expect(warnings().join('\n')).toContain('keeping last known good values');
    expect(warnings().join('\n')).toContain(REDACTED);
    expect(warnings().join('\n')).not.toMatch(/at least 3/i);
  });
});

describe('редактирование при печати проекции', () => {
  it('`util.inspect` отдаёт маску вместо секретного значения', async () => {
    const { cfg } = await project({ VAULT_API_TOKEN: 'sk-live-42' }, 'vault');

    expect(inspect(cfg)).toContain(SECRET_MASK);
    expect(inspect(cfg)).not.toContain('sk-live-42');
    expect(inspect(cfg)).toContain('info');
  });

  it('`JSON.stringify` отдаёт маску вместо секретного значения', async () => {
    const { cfg } = await project({ VAULT_API_TOKEN: 'sk-live-42' }, 'vault');

    expect(JSON.stringify(cfg)).toBe(
      JSON.stringify({ apiToken: SECRET_MASK, logLevel: 'info' }),
    );
  });

  it('чтение поля отдаёт настоящее значение', async () => {
    const { cfg } = await project({ VAULT_API_TOKEN: 'sk-live-42' }, 'vault');

    expect(cfg.apiToken).toBe('sk-live-42');
  });

  it('форма объекта не изменилась: хуки неперечислимы', async () => {
    const { cfg } = await project({ VAULT_API_TOKEN: 'sk-live-42' }, 'vault');

    expect(Object.keys(cfg)).toEqual(['apiToken', 'logLevel']);
    expect(Object.entries(cfg)).toEqual([
      ['apiToken', 'sk-live-42'],
      ['logLevel', 'info'],
    ]);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('спред обходит редактирование — документированная граница гарантии', async () => {
    const { cfg } = await project({ VAULT_API_TOKEN: 'sk-live-42' }, 'vault');

    expect(JSON.stringify({ ...cfg })).toContain('sk-live-42');
  });

  it('секция без секретных полей не получила ни одного нового члена', async () => {
    const { cfg } = await project({}, 'plain');

    expect('toJSON' in cfg).toBe(false);
    expect(Symbol.for('nodejs.util.inspect.custom') in cfg).toBe(false);
    expect(JSON.stringify(cfg)).toBe(JSON.stringify({ logLevel: 'info' }));
  });

  it('эффективная секретность редактирует и печать чужой секции', async () => {
    const container = await build(
      { VAULT_API_TOKEN: 'sk-live-42' },
      (builder) => {
        builder.register(MirrorService);
      },
    );
    const cfg = container.getOrThrow(MirrorService).cfg;

    expect(JSON.stringify(cfg)).toBe(JSON.stringify({ token: SECRET_MASK }));
    expect(cfg.token).toBe('sk-live-42');
  });

  it('reloadable-секция редактирует актуальное значение, `onChange` — настоящее', async () => {
    const { cfg, source } = await project(
      { HOTSECRET_PASSWORD: 'first' },
      'hotsecret',
    );

    expect(JSON.stringify(cfg)).toContain(SECRET_MASK);
    expect(JSON.stringify(cfg)).not.toContain('first');

    const seen: unknown[] = [];
    const controller = new AbortController();
    (cfg as unknown as Config<typeof HotSecretConfig>).onChange(
      controller.signal,
      (next) => seen.push(next.password),
    );

    source.set('HOTSECRET_PASSWORD', 'second');
    await Promise.resolve();
    await Promise.resolve();

    expect(cfg.password).toBe('second');
    expect(JSON.stringify(cfg)).not.toContain('second');
    expect(seen).toEqual(['second']);

    controller.abort();
    expect(reloadableOf(cfg)).toBeDefined();
  });
});

describe('снимок реестра', () => {
  it('значений не содержит и помечает ключ секретным у всех читателей', () => {
    const entry = describeConfig().keys.find(
      (item) => item.key === 'VAULT_API_TOKEN',
    );

    expect(entry?.secret).toBe(true);
    expect(entry?.readers.map((reader) => reader.section)).toContain('mirror');
    expect(JSON.stringify(describeConfig())).not.toContain('sk-');
  });
});

describe('секция без secret() через компонент DI', () => {
  it('без единого secret() объект не получает служебных членов сериализации', async () => {
    const container = await build({}, (builder) => {
      builder.register(PlainService);
    });
    const cfg = container.getOrThrow(PlainService).cfg;

    expect(Object.getOwnPropertyNames(cfg)).toEqual(['logLevel']);
    expect(Object.getOwnPropertySymbols(cfg)).toEqual([]);
  });
});
