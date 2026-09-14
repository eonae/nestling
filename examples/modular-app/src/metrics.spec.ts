/**
 * Метрики примера: своя группа, store ядра и экспозиция плагином.
 *
 * Проверяется то, ради чего метрики в примере вообще есть: приложение
 * объявляет свои метрики значением, ядро копит их вместе со своими, а
 * формат экспозиции приходит пакетом — писать его в примере не нужно.
 */

import { UsersMetrics } from './features/users/users.metrics.js';
import { declareApp } from './app.js';
import { RegisterUser } from './operations.js';
import { describeWithDatabase, testConfig } from './testing.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition } from '@nestlingjs/app';
import { KernelMetrics, makeApp, makeFeature } from '@nestlingjs/app';
import { makePrometheus } from '@nestlingjs/prometheus';
import { buildTest } from '@nestlingjs/testing';
import { http } from '@nestlingjs/transport.http';

/** Текст экспозиции по endpoint'у плагина */
const scrape = async (
  testApp: Awaited<ReturnType<typeof buildTest>>,
  endpoint: AnyEndpointDefinition,
): Promise<string> => {
  const response = await testApp.call(endpoint as never);

  return String(response.value);
};

describe('экспозиция метрик примера', () => {
  it('свежее приложение отдаёт нули по объявленным рядам', async () => {
    const plugin = makePrometheus();
    // Приложение без фич: endpoint приносит плагин, и базы ему не нужно
    const observed = makeApp({
      features: [makeFeature({ name: 'users', metrics: [UsersMetrics] })],
      plugins: [plugin],
      transports: [http()],
    });

    await using testApp = await buildTest(observed);

    const [endpoint] = plugin.endpoints as readonly AnyEndpointDefinition[];
    const text = await scrape(testApp, endpoint as AnyEndpointDefinition);

    expect(text).toContain('# TYPE users_registrations counter');
    expect(text).toContain('users_registrations{outcome="registered"} 0');
    expect(text).toContain('users_registrations{outcome="duplicate"} 0');
  });
});

describeWithDatabase('метрики ядра и приложения в одном store', () => {
  it('обработка команды даёт запись фичи и записи ядра', async () => {
    // Шины в этой сборке нет: обе фичи выбраны, и вызов
    // `notifications.check-address` идёт через `dispatch` — метрика порта
    // при этом пишется та же
    const declared = declareApp();

    await using testApp = await buildTest(declared, {
      args: 'all',
      config: testConfig,
    });

    await testApp.emit(RegisterUser, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    // Ряд прикладной метрики адресуется членом группы, а не строкой
    expect(
      testApp.metrics.counter(UsersMetrics.members.registrations, {
        outcome: 'registered',
      }),
    ).toBe(1);

    // Метрики ядра лежат в том же store
    expect(
      testApp.metrics.counter(KernelMetrics.members.requests, {
        outcome: 'completed',
      }),
    ).toBeGreaterThan(0);
    expect(
      testApp.metrics.counter(KernelMetrics.members['port.calls'], {
        binding: 'local',
      }),
    ).toBeGreaterThan(0);
  });
});
