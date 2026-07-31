/**
 * Примордиальное чтение секции (фаза 0): только `process.env`, синхронно,
 * с той же валидацией, что у проекции из контейнера.
 */

import { ConfigValidationError } from './errors';
import { load } from './load';
import { makeConfig } from './section';
import { objectSource } from './source';

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

const RootConfig = makeConfig('primordial', {
  features: z.string().default('all'),
  replicas: z.coerce.number().int().default(1),
});

/** Выполняет тело с временно выставленными переменными окружения */
const withEnv = (values: Record<string, string>, body: () => void): void => {
  const saved = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);

  try {
    body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe('load', () => {
  it('читает ключи секции из process.env и валидирует их', () => {
    withEnv({ PRIMORDIAL_FEATURES: 'orders,billing' }, () => {
      expect(load(RootConfig)).toEqual({
        features: 'orders,billing',
        replicas: 1,
      });
    });
  });

  it('невалидное значение падает fail-fast со всеми отказами', () => {
    withEnv({ PRIMORDIAL_REPLICAS: 'abc' }, () => {
      expect(() => load(RootConfig)).toThrow(ConfigValidationError);
      expect(() => load(RootConfig)).toThrow(/PRIMORDIAL_REPLICAS/);
    });
  });

  it('привязанные источники в примордиальном чтении не участвуют', () => {
    // Источник, который прочитала бы читалка внутри графа: на фазе 0 его
    // ещё нет, поэтому значение берётся из env
    objectSource({ PRIMORDIAL_FEATURES: 'from-source' }, 'file');

    withEnv({ PRIMORDIAL_FEATURES: 'from-env' }, () => {
      expect(load(RootConfig).features).toBe('from-env');
    });
  });

  it('результат заморожен', () => {
    withEnv({ PRIMORDIAL_FEATURES: 'all' }, () => {
      expect(Object.isFrozen(load(RootConfig))).toBe(true);
    });
  });
});
