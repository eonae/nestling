/**
 * `bind()`, `env()`, `dotenv()` и умолчание `defaultSources`.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bind, defaultSources, dotenv, env } from './source.js';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

describe('bind()', () => {
  it('умолчания: keys — "*", optional — false, timeout — 10000', () => {
    const binding = bind(env());

    expect(binding.keys).toBe('*');
    expect(binding.optional).toBe(false);
    expect(binding.timeout).toBe(10_000);
    expect(binding.source).toBe(binding.source);
  });

  it('опции переопределяют умолчания', () => {
    const source = env();
    const binding = bind(source, {
      keys: '*_URL',
      optional: true,
      timeout: 50,
    });

    expect(binding).toEqual({
      source,
      keys: '*_URL',
      optional: true,
      timeout: 50,
    });
  });
});

describe('dotenv()', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestling-dotenv-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('init() разбирает файл, get() отдаёт значения', async () => {
    const path = join(dir, '.env');
    await writeFile(path, 'ORDERS_MAX_ITEMS=10\n');

    const source = dotenv(path);
    await source.init?.();

    expect(source.get('ORDERS_MAX_ITEMS')).toBe('10');
    expect(source.get('MISSING')).toBeUndefined();
  });

  it('имя несёт путь к файлу', () => {
    expect(dotenv('.env.local').name).toBe('dotenv(.env.local)');
  });

  it('отсутствие файла отказывает init()', async () => {
    const source = dotenv(join(dir, 'missing.env'));

    await expect(source.init?.()).rejects.toThrow();
  });
});

describe('defaultSources', () => {
  it('env выше dotenv, dotenv — optional', () => {
    expect(defaultSources).toHaveLength(2);
    expect(defaultSources[0]?.source.name).toBe('env');
    expect(defaultSources[1]?.source.name).toBe('dotenv(.env)');
    expect(defaultSources[1]?.optional).toBe(true);
  });
});
