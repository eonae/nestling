/**
 * Декларация приложения, одна на все процессы развёртывания.
 *
 * Между процессами меняется только выбор фич в `app.assemble(select)`.
 * Состав транспортов не зависит от роли: `nats()` объявлен всегда.
 */

import { QuotasFeature } from './quotas.js';
import { UsersFeature } from './users.js';

import type { App } from '@nestling/app';
import { makeApp } from '@nestling/app';
import type { NatsTransportOptions } from '@nestling/transport.nats';
import { nats } from '@nestling/transport.nats';

/**
 * Объявляет приложение с заданными опциями брокера.
 *
 * @param transport - Опции транспорта. В бою пусты: адрес брокера приходит
 * из секции конфига `nats`. В тестах сюда передаётся двойник брокера
 */
export function declareApp(transport: NatsTransportOptions = {}): App {
  return makeApp({
    features: [UsersFeature, QuotasFeature],
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...transport, name: 'events' })],
    intercom: 'events',
  });
}

/** Приложение: то же значение для `main.ts`, тестов и проверки топологий */
export const app = declareApp();
