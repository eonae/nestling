/**
 * Источник Vault на подставном `fetch`: форма запроса, разбор ответа,
 * повторы и отказы, которых живой сервер по команде не выдаёт.
 */

import type { VaultCoordinates } from './config.js';
import { VaultConfig } from './config.js';
import { vault } from './source.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

const coordinates: VaultCoordinates = {
  addr: 'https://vault.local',
  token: 's3cr3t',
  mount: 'secret',
  path: 'orders',
};

/** Ответ KV v2 с рекордом секрета */
const secretResponse = (data: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ data: { data } }), { status: 200 });

/** Подставляет `fetch` и отдаёт шпиона */
const stubFetch = (
  ...responses: (Response | Error)[]
): ReturnType<typeof vi.fn> => {
  const fake = vi.fn();

  for (const response of responses) {
    if (response instanceof Error) {
      fake.mockRejectedValueOnce(response);
    } else {
      fake.mockResolvedValueOnce(response);
    }
  }

  vi.stubGlobal('fetch', fake);

  return fake;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('чтение секрета', () => {
  it('значения приходят из рекорда `data.data`', async () => {
    stubFetch(
      secretResponse({
        ORDERS_DATABASE_URL: 'postgresql://localhost/orders',
        ORDERS_API_TOKEN: 'token',
      }),
    );

    const source = vault(VaultConfig);
    await source.init?.(coordinates);

    expect(source.get('ORDERS_DATABASE_URL')).toBe(
      'postgresql://localhost/orders',
    );
    expect(source.get('ORDERS_API_TOKEN')).toBe('token');
  });

  it('ключ, которого в секрете нет, — «пропускаю ход»', async () => {
    stubFetch(secretResponse({ ORDERS_API_TOKEN: 'token' }));

    const source = vault(VaultConfig);
    await source.init?.(coordinates);

    expect(source.get('ORDERS_DATABASE_URL')).toBeUndefined();
  });

  it('запрос идёт один, дальше читается запомненный рекорд', async () => {
    const fake = stubFetch(secretResponse({ ORDERS_API_TOKEN: 'token' }));

    const source = vault(VaultConfig);
    await source.init?.(coordinates);

    source.get('ORDERS_API_TOKEN');
    source.get('ORDERS_DATABASE_URL');

    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('форма запроса — KV v2 с заголовком токена', async () => {
    const fake = stubFetch(secretResponse({}));

    const source = vault(VaultConfig);
    await source.init?.({ ...coordinates, mount: 'kv', path: 'team/orders' });

    expect(fake).toHaveBeenCalledWith(
      'https://vault.local/v1/kv/data/team/orders',
      { headers: { 'X-Vault-Token': 's3cr3t' } },
    );
  });

  it('источник объявляет переданную секцию своей зависимостью', () => {
    const source = vault(VaultConfig);

    expect(source.needs).toBe(VaultConfig);
    expect(source.name).toBe('vault(vault)');
  });
});

describe('отказы', () => {
  it('отказ прав называет адрес, но не токен', async () => {
    stubFetch(new Response('', { status: 403 }));

    const source = vault(VaultConfig);
    const error = await (source.init?.(coordinates) as Promise<void>).catch(
      (error_: unknown) => error_,
    );

    expect((error as Error).message).toContain('https://vault.local');
    expect((error as Error).message).toContain("mount 'secret'");
    expect((error as Error).message).toContain("path 'orders'");
    expect((error as Error).message).not.toContain('s3cr3t');
  });

  it('отсутствие секрета названо путём', async () => {
    stubFetch(new Response('', { status: 404 }));

    const source = vault(VaultConfig);
    const error = await (source.init?.(coordinates) as Promise<void>).catch(
      (error_: unknown) => error_,
    );

    expect((error as Error).message).toMatch(/404/);
    expect((error as Error).message).toContain("path 'orders'");
  });

  it('ответ без рекорда секрета отказывает', async () => {
    stubFetch(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    const source = vault(VaultConfig);
    const error = await (source.init?.(coordinates) as Promise<void>).catch(
      (error_: unknown) => error_,
    );

    expect((error as Error).message).toContain("'data.data'");
  });
});

describe('повторы', () => {
  it('временная недоступность переживается', async () => {
    vi.useFakeTimers();

    const fake = stubFetch(
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
      secretResponse({ ORDERS_API_TOKEN: 'token' }),
    );

    const source = vault(VaultConfig, { retries: 2 });
    const raising = source.init?.(coordinates);

    // Пауза удваивается: 250 мс перед первым повтором, 500 перед вторым
    await vi.advanceTimersByTimeAsync(750);
    await raising;

    expect(fake).toHaveBeenCalledTimes(3);
    expect(source.get('ORDERS_API_TOKEN')).toBe('token');
  });

  it('сетевой отказ повторяется', async () => {
    vi.useFakeTimers();

    const fake = stubFetch(
      new Error('ECONNREFUSED'),
      secretResponse({ ORDERS_API_TOKEN: 'token' }),
    );

    const source = vault(VaultConfig, { retries: 1 });
    const raising = source.init?.(coordinates);

    await vi.advanceTimersByTimeAsync(250);
    await raising;

    expect(fake).toHaveBeenCalledTimes(2);
  });

  it('попытки кончаются отказом последней', async () => {
    vi.useFakeTimers();

    stubFetch(
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
    );

    const source = vault(VaultConfig, { retries: 1 });
    const raising = (source.init?.(coordinates) as Promise<void>).catch(
      (error_: unknown) => error_,
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(((await raising) as Error).message).toMatch(/503/);
  });

  it('отказ прав не повторяется', async () => {
    const fake = stubFetch(new Response('', { status: 403 }));

    const source = vault(VaultConfig, { retries: 3 });

    await expect(source.init?.(coordinates)).rejects.toThrow(/403/);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('без опции попытка одна', async () => {
    const fake = stubFetch(new Response('', { status: 503 }));

    const source = vault(VaultConfig);

    await expect(source.init?.(coordinates)).rejects.toThrow(/503/);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
