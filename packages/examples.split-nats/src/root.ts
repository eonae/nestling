/**
 * Composition root, один на все процессы развёртывания.
 *
 * Между процессами меняется только `select`. Состав транспортов не зависит
 * от роли: `nats()` объявлен всегда.
 */

import { QuotasFeature } from './quotas';
import { UsersFeature } from './users';

import type { App, FeatureSelection } from '@nestling/app';
import { assemble } from '@nestling/app';
import type { NatsTransportOptions } from '@nestling/transport.nats';
import { nats } from '@nestling/transport.nats';

/**
 * Собирает приложение для роли, заданной выбором фич.
 *
 * @param select - `'all'` поднимает обе фичи одним процессом, `'users'` и
 * `'quotas'` — по одной фиче на процесс
 * @param transport - Опции транспорта. В бою пусты: адрес брокера приходит
 * из секции конфига `nats`. В тестах сюда передаётся двойник брокера
 */
export function makeRoot(
  select: FeatureSelection,
  transport: NatsTransportOptions = {},
): App {
  return assemble({
    features: [UsersFeature, QuotasFeature],
    select,
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...transport, name: 'events' })],
    intercom: 'events',
  });
}
