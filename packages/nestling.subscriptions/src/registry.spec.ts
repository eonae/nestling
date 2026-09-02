/**
 * Реестр без пайплайна: `open`/`close` зовутся напрямую, контекст —
 * фикстура. Так проверяется сам реестр, а не его слой.
 */

import { makeCtx } from './__fixtures__/context';
import { SubscriptionKilledError } from './errors';
import { SubscriptionRegistry } from './registry';
import type { CloseReason, SubscriptionEvent } from './types';

import { describe, expect, it } from '@jest/globals';
import { events } from '@nestling/operations';
import type { Outcome } from '@nestling/pipeline';
import { collect } from '@nestling/streams';
import { z } from 'zod';

const Item = z.object({ id: z.string() });

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
  registry.dispose();

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

  it('вычисляет identity и labels экстракторами', () => {
    const registry = new SubscriptionRegistry({
      identity: (ctx) => (ctx.input as { userId?: string }).userId,
      labels: (ctx) => ({ tenant: String(ctx.raw.attributes.tenant) }),
    });

    const { id } = registry.open(
      makeCtx({ input: { userId: 'u-1' } as Record<string, unknown> }),
    );

    expect(registry.get(id)).toMatchObject({
      identity: 'u-1',
      labels: { tenant: 'undefined' },
    });
  });

  it('фильтрует по паттерну, identity и подмножеству меток', () => {
    const registry = new SubscriptionRegistry({
      identity: (ctx) => (ctx.input as { userId?: string }).userId,
      labels: (ctx) =>
        (ctx.input as { labels?: Record<string, string> }).labels ?? {},
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
    registry.dispose();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ type: 'opened', info: { id } });
    expect(seen[1]).toMatchObject({
      type: 'closed',
      info: { id },
      reason: 'disconnected',
    });
  });

  it('завершает наблюдателей на @OnDestroy без ошибки', async () => {
    const registry = new SubscriptionRegistry();
    const feed = registry.watch();

    registry.dispose();

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
