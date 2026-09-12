/**
 * Декларация приложения, одна на все процессы развёртывания.
 *
 * Между процессами меняется только выбор фич в `app.assemble(select)`.
 * Состав транспортов не зависит от роли: `nats()` и `http()` объявлены
 * всегда — шина переносит операции, HTTP отдаёт метрики сборщику.
 */

import { metricsPlugin, prometheusExporter } from './metrics.js';
import { QuotasFeature } from './quotas.js';
import { UsersFeature } from './users.js';

import type { App } from '@nestlingjs/app';
import { makeApp, objectSource } from '@nestlingjs/app';
import { http, httpServerKeys } from '@nestlingjs/transport.http';
import type { NatsTransportOptions } from '@nestlingjs/transport.nats';
import { nats } from '@nestlingjs/transport.nats';

/** Опции объявления: всё, что различается между боем и тестом */
export interface DeclareOptions {
  /**
   * Опции транспорта шины. В бою пусты: адрес брокера приходит из секции
   * конфига `nats`. В тестах сюда передаётся двойник брокера
   */
  nats?: NatsTransportOptions;

  /**
   * Порт HTTP-сервера метрик. В бою не задан: его читает секция `http`
   * из `HTTP_PORT`. Тест, поднимающий два процесса сразу, передаёт `0` —
   * два слушателя на один порт не биндятся
   */
  httpPort?: number;
}

/**
 * Объявляет приложение.
 *
 * Адаптер метрик создаётся здесь и уходит в два места сразу: опцией
 * `metrics` он становится корнем, под которым ядро считает запросы и
 * вызовы портов, и узлом графа — его читает endpoint `/metrics`.
 *
 * @param options - Опции брокера и порт сервера метрик
 */
export function declareApp(options: DeclareOptions = {}): App {
  const exporter = prometheusExporter();

  return makeApp({
    features: [UsersFeature, QuotasFeature],
    plugins: [metricsPlugin(exporter)],
    // Шина приложения — обычный транспорт. `intercom:` назначает ему роль
    // переносчика операций между процессами: вызов операции, владелец
    // которой не выбран в этой сборке, уходит через этот транспорт
    transports: [nats({ ...options.nats, name: 'events' }), http()],
    intercom: 'events',
    metrics: exporter,
    ...(options.httpPort === undefined
      ? {}
      : {
          config: [
            [
              objectSource({ HTTP_PORT: String(options.httpPort) }),
              httpServerKeys(),
            ],
          ],
        }),
  });
}

/** Приложение: то же значение для `main.ts`, тестов и проверки топологий */
export const app = declareApp();
