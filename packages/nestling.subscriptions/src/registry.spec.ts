/**
 * Реестр без пайплайна: `open`/`close` зовутся напрямую, контекст —
 * фикстура. Так проверяется сам реестр, а не его слой.
 */

import { makeCtx } from './__fixtures__/context.js';
import { computed } from './computed.js';
import { SubscriptionKilledError } from './errors.js';
import { SubscriptionRegistry } from './registry.js';
import type { CloseReason, SubscriptionEvent } from './types.js';

import { describe, expect, it } from '@jest/globals';
import type { Outcome } from '@nestlingjs/app';
import { contextVar } from '@nestlingjs/app';
import { collect, events } from '@nestlingjs/operations';
import { z } from 'zod';

const Item = z.object({ id: z.string() });

/** Прикладные переменные: их кладёт пайплайн, реестр только читает */
const UserId = contextVar<string>()('userId');
const TenantId = contextVar<string>()('tenantId');
const Labels = contextVar<Record<string, string>>()('labels');

/**
 * Читает ровно `count` событий ленты.
 *
 * Именно `next()`, а не `collect()`: закрытие темы завершает подписки
 * **немедленно**, освобождая буфер, поэтому «дочитать после `close()`»
 * событий не даёт — и это документированное поведение `Topic`, а не
 * дефект реестра.
 */
async function readEvents(
  feed: AsyncIterableIterator<SubscriptionEvent>,
  count: number,
): Promise<SubscriptionEvent[]> {
  const seen: SubscriptionEvent[] = [];

  for (let i = 0; i < count; i += 1) {
    const next = await feed.next();
    if (next.done) {
      break;
    }
    seen.push(next.value);
  }

  return seen;
}

/**
 * Причина, с которой запись ушла из реестра.
 *
 * @param outcome - исход, который пайплайн передал бы в `.finally`
 * @param kill - подписку до этого завершили административно
 */
async function reasonOf(
  outcome: Outcome,
  { kill = false }: { kill?: boolean } = {},
): Promise<CloseReason> {
  const registry = new SubscriptionRegistry();
  const feed = registry.watch();
  const { id } = registry.open(makeCtx());

  if (kill) {
    registry.abort(id);
  }
  registry.close(id, outcome);

  const [, closed] = await readEvents(feed, 2);
  registry.release();

  if (closed?.type !== 'closed') {
    throw new Error('лента не отдала событие закрытия');
  }

  return closed.reason;
}

describe('SubscriptionRegistry: снимок', () => {
  it('собирается заново и заморожен', () => {
    const registry = new SubscriptionRegistry();
    const ctx = makeCtx({ pattern: 'GET /api/feed', output: events(Item) });

    const { id } = registry.open(ctx);

    const [first] = registry.list();
    expect(first).toMatchObject({
      id,
      transport: 'http',
      pattern: 'GET /api/feed',
      kind: 'events',
      labels: {},
      itemsOut: 0,
    });
    expect(Object.isFrozen(first)).toBe(true);

    // Поток дотёк до второго элемента: снимок на руках не меняется, новый
    // снимок это видит
    ctx.summary.itemsOut = 2;
    expect(first.itemsOut).toBe(0);
    expect(registry.get(id)?.itemsOut).toBe(2);
  });

  it('фильтрует по паттерну, identity и подмножеству меток', () => {
    const registry = new SubscriptionRegistry({
      identity: UserId,
      labels: computed([Labels], (_ctx, labels) => labels ?? {}),
    });

    registry.open(
      makeCtx({
        pattern: 'GET /api/feed',
        input: { userId: 'u-1', labels: { tier: 'gold', region: 'eu' } },
      }),
    );
    registry.open(
      makeCtx({ pattern: 'GET /api/export', input: { userId: 'u-2' } }),
    );

    expect(registry.size).toBe(2);
    expect(registry.list({ pattern: 'GET /api/feed' })).toHaveLength(1);
    expect(registry.list({ identity: 'u-2' })).toHaveLength(1);
    expect(registry.list({ transport: 'cli' })).toHaveLength(0);
    expect(registry.list({ labels: { tier: 'gold' } })).toHaveLength(1);
    expect(
      registry.list({ labels: { tier: 'gold', region: 'us' } }),
    ).toHaveLength(0);
  });
});

describe('SubscriptionRegistry: источник identity', () => {
  it('называет подписанта значением переменной', () => {
    const registry = new SubscriptionRegistry({
      identity: UserId,
      labels: (ctx) => ({ transport: ctx.endpoint.transport }),
    });

    const { id } = registry.open(makeCtx({ input: { userId: 'u-1' } }));

    expect(registry.get(id)).toMatchObject({
      identity: 'u-1',
      labels: { transport: 'http' },
    });
  });

  it('оставляет подписку без identity, если пайплайн переменную не положил', () => {
    const registry = new SubscriptionRegistry({ identity: UserId });

    const { id } = registry.open(makeCtx());

    expect(registry.size).toBe(1);
    expect(registry.get(id)?.identity).toBeUndefined();
  });

  it('нестроковое значение переменной равносильно её отсутствию', () => {
    const registry = new SubscriptionRegistry({ identity: UserId });

    const { id } = registry.open(makeCtx({ input: { userId: 42 } }));

    expect(registry.get(id)?.identity).toBeUndefined();
  });

  it('разбирает форму опции при создании, а не на каждом открытии', () => {
    let reads = 0;
    // Переменная, которая считает обращения к своей форме: так видно, что
    // `open()` по форме опции не ветвится
    const counted = {
      get key(): string {
        reads += 1;

        return UserId.key;
      },
    };

    const registry = new SubscriptionRegistry({ identity: counted });
    const onCreate = reads;

    for (let i = 0; i < 5; i += 1) {
      registry.open(makeCtx({ input: { userId: 'u-1' } }));
    }

    expect(onCreate).toBeGreaterThan(0);
    expect(reads).toBe(onCreate);
    expect(registry.list({ identity: 'u-1' })).toHaveLength(5);
  });
});

describe('SubscriptionRegistry: computed', () => {
  it('склеивает ключ из двух переменных', () => {
    const registry = new SubscriptionRegistry({
      identity: computed(
        [TenantId, UserId],
        (_ctx, tenant, user) => `${tenant}:${user}`,
      ),
    });

    const { id } = registry.open(
      makeCtx({ input: { tenantId: 't-1', userId: 'u-1' } }),
    );

    expect(registry.get(id)?.identity).toBe('t-1:u-1');
  });

  it('отдаёт вычислению undefined вместо непоставленного значения', () => {
    const registry = new SubscriptionRegistry({
      identity: computed([TenantId, UserId], (_ctx, tenant, user) =>
        user === undefined ? undefined : `${tenant ?? 'общий'}:${user}`,
      ),
    });

    const { id } = registry.open(makeCtx({ input: { userId: 'u-1' } }));
    const { id: anonymous } = registry.open(makeCtx());

    expect(registry.get(id)?.identity).toBe('общий:u-1');
    expect(registry.get(anonymous)?.identity).toBeUndefined();
  });

  it("годится в labels вместе с метаданными endpoint'а", () => {
    const registry = new SubscriptionRegistry({
      labels: computed([TenantId], (ctx, tenant) => ({
        tenant: tenant ?? 'общий',
        transport: ctx.endpoint.transport,
      })),
    });

    const { id } = registry.open(makeCtx({ input: { tenantId: 't-1' } }));

    expect(registry.get(id)?.labels).toEqual({
      tenant: 't-1',
      transport: 'http',
    });
  });
});

describe('SubscriptionRegistry: административное завершение', () => {
  it('взводит собственный сигнал, но записи не снимает', () => {
    const registry = new SubscriptionRegistry();
    const request = new AbortController();
    const { id, signal } = registry.open(makeCtx({ signal: request.signal }));

    expect(registry.abort(id, 'узел уходит на деплой')).toBe(true);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(SubscriptionKilledError);
    expect((signal.reason as SubscriptionKilledError).id).toBe(id);
    expect((signal.reason as SubscriptionKilledError).reason).toBe(
      'узел уходит на деплой',
    );

    // Сигнал запроса административный kill не трогает
    expect(request.signal.aborted).toBe(false);

    // Запись снимет `.finally`, а не `abort()`: реестр отражает факт
    expect(registry.size).toBe(1);
  });

  it('возвращает false для несуществующей подписки', () => {
    const registry = new SubscriptionRegistry();

    expect(registry.abort('нет-такого')).toBe(false);
  });

  it('abortAll возвращает число завершённых', () => {
    const registry = new SubscriptionRegistry();
    registry.open(makeCtx({ pattern: 'GET /api/feed' }));
    registry.open(makeCtx({ pattern: 'GET /api/feed' }));
    registry.open(makeCtx({ pattern: 'GET /api/export' }));

    expect(registry.abortAll({ pattern: 'GET /api/feed' })).toBe(2);
    expect(registry.abortAll()).toBe(3);
    expect(registry.abortAll({ pattern: 'нет такого' })).toBe(0);
  });
});

describe('SubscriptionRegistry: причина закрытия', () => {
  it('повторяет Outcome ядра, когда реестр не вмешивался', async () => {
    await expect(reasonOf('completed')).resolves.toBe('completed');
    await expect(reasonOf('disconnected')).resolves.toBe('disconnected');
    await expect(reasonOf('aborted')).resolves.toBe('aborted');
    await expect(reasonOf('failed')).resolves.toBe('failed');
  });

  it('говорит killed там, где ядро видит completed', async () => {
    await expect(reasonOf('completed', { kill: true })).resolves.toBe('killed');
  });

  it('снимает запись и взводит собственный контроллер', () => {
    const registry = new SubscriptionRegistry();
    const { id, signal } = registry.open(makeCtx());

    registry.close(id, 'completed');

    expect(registry.size).toBe(0);
    expect(registry.get(id)).toBeUndefined();
    // Композитный сигнал отвязан от сигнала запроса детерминированно
    expect(signal.aborted).toBe(true);
  });

  it('закрытие несуществующей записи — no-op', () => {
    const registry = new SubscriptionRegistry();

    expect(() => registry.close('нет-такого', 'completed')).not.toThrow();
  });
});

describe('SubscriptionRegistry: лента', () => {
  it('отдаёт наблюдателю открытие и закрытие', async () => {
    const registry = new SubscriptionRegistry();
    const feed = registry.watch();

    const { id } = registry.open(makeCtx({ pattern: 'GET /api/feed' }));
    registry.close(id, 'disconnected');

    const seen = await readEvents(feed, 2);
    registry.release();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ type: 'opened', info: { id } });
    expect(seen[1]).toMatchObject({
      type: 'closed',
      info: { id },
      reason: 'disconnected',
    });
  });

  it('завершает наблюдателей освобождением без ошибки', async () => {
    const registry = new SubscriptionRegistry();
    const feed = registry.watch();

    registry.release();

    await expect(collect(feed)).resolves.toEqual([]);
  });

  it('не задерживает регистрацию из-за медленного наблюдателя', () => {
    const registry = new SubscriptionRegistry({ feedBuffer: 2 });
    const feed = registry.watch();

    for (let i = 0; i < 10; i += 1) {
      const { id } = registry.open(makeCtx());
      registry.close(id, 'completed');
    }

    // Наблюдатель не прочитал ни одного события — регистрация от этого не
    // остановилась, а лишнее ушло по `drop-oldest`
    expect(registry.size).toBe(0);
    expect(feed).toBeDefined();
  });
});
