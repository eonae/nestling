/**
 * Факты жизненного цикла: схемы, написанные руками, и поведение реестра
 * при отказе публикации.
 *
 * Проверка схем здесь не про валидацию вообще, а про одно утверждение
 * замера: satellite объявляет операция, не подключая вендора схем.
 */

import { makeCtx } from './__fixtures__/context.js';
import { SubscriptionClosed, SubscriptionOpened } from './operations.js';
import { SubscriptionRegistry } from './registry.js';
import type { SubscriptionEvent } from './types.js';

import type { StandardSchemaV1 } from '@common/misc';
import { describe, expect, it } from '@jest/globals';
import type { Emitter } from '@nestling/operations';

/** Синхронная валидация формы-листа: `Promise` в ядре считается ошибкой */
function check(
  schema: unknown,
  value: unknown,
): StandardSchemaV1.Result<unknown> {
  const result = (schema as StandardSchemaV1)['~standard'].validate(value);

  if (result instanceof Promise) {
    throw new TypeError('схема пакета обязана быть синхронной');
  }

  return result;
}

/** Эмиттер, который всегда отказывает: шина легла */
const broken = (): Emitter<any> => ({
  emit: async () => {
    throw new Error('bus is down');
  },
});

describe('схемы фактов', () => {
  it('объявлены без вендора', () => {
    expect(
      (SubscriptionOpened.input as StandardSchemaV1)['~standard'].vendor,
    ).toBe('nestling');
    expect(
      (SubscriptionClosed.input as StandardSchemaV1)['~standard'].vendor,
    ).toBe('nestling');
  });

  it('пропускают объявленные поля и отбрасывают лишние', () => {
    const result = check(SubscriptionOpened.input, {
      node: 'node-1',
      id: 's-1',
      transport: 'http',
      pattern: 'GET /api/feed',
      kind: 'events',
      startedAt: 1,
      somethingElse: 'мусор',
    });

    expect(result.issues).toBeUndefined();
    expect('value' in result && result.value).toEqual({
      node: 'node-1',
      id: 's-1',
      transport: 'http',
      pattern: 'GET /api/feed',
      kind: 'events',
      startedAt: 1,
    });
  });

  it('не требуют необязательных полей', () => {
    const result = check(SubscriptionOpened.input, {
      id: 's-1',
      transport: 'http',
      pattern: 'GET /api/feed',
      kind: 'value',
      startedAt: 1,
    });

    expect(result.issues).toBeUndefined();
    expect('value' in result && result.value).not.toHaveProperty('node');
  });

  it('отказывают на неверном типе, отсутствии поля и значении вне словаря', () => {
    expect(check(SubscriptionOpened.input, 'строка').issues).toHaveLength(1);

    expect(
      check(SubscriptionOpened.input, {
        id: 's-1',
        transport: 'http',
        pattern: 'GET /api/feed',
        kind: 'events',
      }).issues,
    ).toMatchObject([{ path: ['startedAt'] }]);

    expect(
      check(SubscriptionClosed.input, {
        id: 's-1',
        reason: 'выдумка',
        itemsOut: 0,
        closedAt: 1,
      }).issues,
    ).toMatchObject([{ path: ['reason'] }]);
  });
});

describe('публикация фактов', () => {
  it('не ломает подписку и отдаёт ошибку в хук', async () => {
    const failures: { error: unknown; event: SubscriptionEvent }[] = [];

    const registry = new SubscriptionRegistry(
      {
        onPublishError: (error, event) => {
          failures.push({ error, event });
        },
      },
      broken(),
      broken(),
    );

    const { id } = registry.open(makeCtx());
    expect(registry.size).toBe(1);

    registry.close(id, 'completed');
    expect(registry.size).toBe(0);

    // Публикация не на горячем пути: хук получает отказ следующим тиком
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect(failures).toHaveLength(2);
    expect(failures.map(({ event }) => event.type)).toEqual([
      'opened',
      'closed',
    ]);
    expect((failures[0].error as Error).message).toBe('bus is down');
  });

  it('без эмиттеров ничего не публикует и хука не зовёт', async () => {
    const failures: unknown[] = [];
    const registry = new SubscriptionRegistry({
      onPublishError: (error) => failures.push(error),
    });

    const { id } = registry.open(makeCtx());
    registry.close(id, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 1));

    expect(failures).toEqual([]);
  });
});
