/**
 * Composition root примера — **один** на все процессы развёртывания.
 *
 * Между процессами меняется ровно `select`: состав транспортов статичен, и
 * тернарника `NATS_URL ? nats() : undefined` здесь нет и быть не может —
 * он был бы враньём о том, чем приложение является.
 */

import { OrdersFeature } from './orders';
import { QuotasFeature } from './quotas';

import type { App, FeatureSelection } from '@nestling/app';
import { assemble } from '@nestling/app';
import type { NatsTransportOptions } from '@nestling/transport.nats';
import { nats } from '@nestling/transport.nats';

/**
 * Собирает приложение для роли, заданной выбором фич.
 *
 * @param select - Выбор фич: `'all'` — L3 (одним процессом), `'orders'` и
 * `'quotas'` — две половины L4
 * @param transport - Опции транспорта; в бою пусты (всё приходит из
 * секции `nats`), в тестах сюда передаётся двойник брокера
 */
export function makeRoot(
  select: FeatureSelection,
  transport: NatsTransportOptions = {},
): App {
  return assemble({
    features: [OrdersFeature, QuotasFeature],
    select,
    // Шина приложения — обычный транспорт-провайдер. Именно она делает
    // `quotas.claim` вызываемым из процесса, где `quotas` не выбрана:
    // in-process шина не доставляет за пределы процесса, брокерская —
    // доставляет, и это единственный вход remote-биндинга
    transports: [nats(transport)],
  });
}
