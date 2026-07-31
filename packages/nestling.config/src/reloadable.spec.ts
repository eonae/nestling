/**
 * Reloadable: read-latest, стабильный инстанс, `onChange` поверх `Topic`,
 * keep-last-good на невалидном обновлении.
 */

import type { SectionDeclaration } from './declaration.js';
import type { Config } from './families.js';
import { projectSection, reloadableOf } from './project.js';
import { ConfigReader } from './reader.js';
import { lookupSection } from './registry.js';
import { makeConfig } from './section.js';
import type { ObjectSource } from './source.js';
import { objectSource } from './source.js';

import { z } from 'zod';

const Runtime = makeConfig.reloadable('runtime', {
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  rps: z.coerce.number().default(100),
});

type RuntimeValues = Config<typeof Runtime>;

const warnings: string[] = [];

/** Поднимает читалку с одним объектным источником и проецирует секцию. */
const project = async (
  values: Record<string, unknown>,
): Promise<{ cfg: RuntimeValues; source: ObjectSource }> => {
  const source = objectSource(values, 'test');
  const reader = new ConfigReader([[source, '*']], {
    onWarn: (message) => warnings.push(message),
  });
  await reader.init();

  const declaration = lookupSection('runtime') as SectionDeclaration;

  return {
    cfg: projectSection(declaration, reader) as RuntimeValues,
    source,
  };
};

/** Даёт микрозадачам подписки прокрутиться. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  warnings.length = 0;
});

describe('объявление reloadable-секции', () => {
  it('попадает в реестр со своими ключами', () => {
    expect(Runtime.keys.names).toEqual(['RUNTIME_LOG_LEVEL', 'RUNTIME_RPS']);
    expect(lookupSection('runtime')?.reloadable).toBe(true);
  });
});

describe('read-latest без подписки', () => {
  it('чтение поля отдаёт последнее валидное значение', async () => {
    const { cfg, source } = await project({ RUNTIME_LOG_LEVEL: 'info' });

    expect(cfg.logLevel).toBe('info');

    source.set('RUNTIME_LOG_LEVEL', 'debug');

    expect(cfg.logLevel).toBe('debug');
  });

  it('инстанс стабилен: ссылка, взятая до обновления, актуальна после', async () => {
    const { cfg, source } = await project({ RUNTIME_RPS: '10' });
    const captured = cfg;

    source.set('RUNTIME_RPS', '20');

    expect(captured).toBe(cfg);
    expect(captured.rps).toBe(20);
  });

  it('скопированное значение не обновляется — это ответственность потребителя', async () => {
    const { cfg, source } = await project({ RUNTIME_RPS: '10' });
    const copy = cfg.rps;

    source.set('RUNTIME_RPS', '20');

    expect(copy).toBe(10);
    expect(cfg.rps).toBe(20);
  });

  it('присвоить полю нельзя', async () => {
    const { cfg } = await project({});

    expect(() => {
      (cfg as { rps: number }).rps = 1;
    }).toThrow(TypeError);
  });
});

describe('onChange(signal, cb)', () => {
  it('вызывается с новым значением секции после успешного обновления', async () => {
    const { cfg, source } = await project({ RUNTIME_RPS: '10' });
    const seen: number[] = [];
    const controller = new AbortController();

    cfg.onChange(controller.signal, (next) => seen.push(next.rps));
    await settle();

    source.set('RUNTIME_RPS', '20');
    await settle();

    expect(seen).toEqual([20]);
  });

  it('отписывается по сигналу и освобождает подписку', async () => {
    const { cfg, source } = await project({ RUNTIME_RPS: '10' });
    const seen: number[] = [];
    const controller = new AbortController();

    cfg.onChange(controller.signal, (next) => seen.push(next.rps));
    await settle();

    expect(reloadableOf(cfg)?.subscribers).toBe(1);

    controller.abort();
    await settle();

    source.set('RUNTIME_RPS', '30');
    await settle();

    expect(seen).toEqual([]);
    expect(reloadableOf(cfg)?.subscribers).toBe(0);
  });
});

describe('асимметрия старта и обновления', () => {
  it('невалидное горячее значение не роняет процесс — keep last-good + warn', async () => {
    const { cfg, source } = await project({ RUNTIME_RPS: '10' });
    const seen: number[] = [];
    const controller = new AbortController();
    cfg.onChange(controller.signal, (next) => seen.push(next.rps));
    await settle();

    source.set('RUNTIME_RPS', 'abc');
    await settle();

    expect(cfg.rps).toBe(10);
    expect(seen).toEqual([]);
    expect(warnings.at(-1)).toMatch(
      /keeping last known good values.+'runtime'/,
    );
  });

  it('частичное обновление не применяется наполовину', async () => {
    const { cfg, source } = await project({
      RUNTIME_RPS: '10',
      RUNTIME_LOG_LEVEL: 'info',
    });

    source.assign({ RUNTIME_LOG_LEVEL: 'debug', RUNTIME_RPS: 'abc' });

    expect(cfg.logLevel).toBe('info');
    expect(cfg.rps).toBe(10);
  });

  it('невалидное значение на старте — обычный fail-fast', async () => {
    await expect(project({ RUNTIME_RPS: 'abc' })).rejects.toThrow(
      /Config section 'runtime' is invalid/,
    );
  });
});

describe('источник без наблюдения', () => {
  it('reloadable на голом env поднимается с предупреждением', async () => {
    const reader = new ConfigReader([], {
      onWarn: (message) => warnings.push(message),
    });
    await reader.init();

    const declaration = lookupSection('runtime') as SectionDeclaration;
    const cfg = projectSection(declaration, reader) as RuntimeValues;

    expect(cfg.rps).toBe(100);
    expect(warnings).toEqual([
      expect.stringContaining('no source that supports watch'),
    ]);
  });
});
