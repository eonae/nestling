/**
 * Декларация приложения, одна на все процессы развёртывания.
 *
 * Между процессами меняется только выбор фич в `app.build(args)`.
 * Состав транспортов от роли не зависит: `nats()` объявлен всегда — шина
 * переносит операции, — и `http()` тоже: он отдаёт пробы и метрики.
 */

import { NotificationsFeature } from './features/notifications/notifications.feature.js';
import { UsersFeature } from './features/users/users.feature.js';
import { metricsPlugin, prometheusExporter } from './metrics.js';
import { UserRegistered } from './operations.js';
import { db, inbox, inboxStore, outboxStore } from './persistence.js';
import { Mail } from './switches.js';

import type { App } from '@nestlingjs/app';
import {
  BusTransport$,
  everyEndpoint,
  IdempotencyKey,
  makeApp,
} from '@nestlingjs/app';
import { makeOutbox } from '@nestlingjs/outbox';
import { http, makeHttpProbes } from '@nestlingjs/transport.http';
import type { NatsTransportOptions } from '@nestlingjs/transport.nats';
import { nats } from '@nestlingjs/transport.nats';

/** Опции объявления: всё, что различается между боем и тестом */
export interface DeclareOptions {
  /**
   * Опции транспорта шины. В бою пусты: адрес брокера приходит из секции
   * конфига `nats`. В тестах сюда передаётся двойник брокера
   */
  nats?: NatsTransportOptions;
}

/**
 * Транзакционный emit: событие уходит в шину после коммита.
 *
 * Плагин создаётся один раз: рецепт семейства регистрируется однажды.
 * Раздел записи плагин не назначает — его называет место вызова `emit`.
 */
export const outbox = makeOutbox({
  transaction: db.tx,
  store: outboxStore.token,
  operations: [UserRegistered],
});

/**
 * Объявляет приложение.
 *
 * Адаптер метрик создаётся здесь и уходит в два места сразу: опцией
 * `metrics` он становится корнем, под которым ядро считает запросы и
 * вызовы портов, и узлом графа — его читает endpoint `GET /metrics`.
 *
 * @param options - Опции брокера
 */
export function declareApp(options: DeclareOptions = {}): App<[typeof Mail]> {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, NotificationsFeature],
    plugins: [
      db,
      outboxStore,
      outbox,
      inboxStore,
      inbox,
      metricsPlugin(exporter),
      // Пробы `GET /healthz` и `GET /readyz` поверх узла ядра `Health$`:
      // правило готовности принадлежит ядру, плагину — только адреса и
      // коды
      makeHttpProbes(),
    ],
    switches: [Mail],
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
    policies: [
      // Дедуплицирует тот, кому доставку могут повторить: под
      // durable-событием лежит поток JetStream, и подписчик обязан быть
      // готов увидеть сообщение дважды. Без слоя это относилось бы к
      // обязанностям подписчика соглашением, а здесь проверяется на
      // сборке — нарушение видно до фазы INIT
      inbox.requiresInbox(
        { transport: BusTransport$, pattern: /^users\.registered/ },
        'inbox',
      ),
      // Реализация команды удаления кладёт ключ идемпотентности в
      // контекст: сервис в глубине графа читает его через `Ctx`
      everyEndpoint({
        transport: BusTransport$,
        pattern: /^notifications\.forget-address$/,
      }).hasVar(IdempotencyKey, 'idempotencyKey'),
    ],
  });
}

/** Приложение: то же значение для `main.ts`, тестов и проверки топологий */
export const app = declareApp();
