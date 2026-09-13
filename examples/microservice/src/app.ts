import { ops } from './ops/index.js';
import { UserCreated } from './users/users.events.js';
import { authed } from './auth.js';
import { metricsPlugin, prometheusExporter } from './metrics.js';
import { observability } from './observability.js';
import { appInbox, db, inboxStore, outboxStore } from './persistence.js';
import { UsersFeature } from './users.feature.js';

import {
  BusTransport$,
  everyEndpoint,
  makeApp,
  RequestId,
} from '@nestlingjs/app';
import { makeSwitch } from '@nestlingjs/container';
import { mcp, McpTransport$ } from '@nestlingjs/mcp';
import type { OpenApiOptions } from '@nestlingjs/openapi';
import { openapi } from '@nestlingjs/openapi';
import { outbox } from '@nestlingjs/outbox';
import { zodConverter } from '@nestlingjs/schema.zod';
import { http, httpServer, HttpTransport$ } from '@nestlingjs/transport.http';

/**
 * Транзакционный emit: событие уходит в шину после коммита.
 *
 * Плагин создаётся один раз: рецепт семейства регистрируется однажды.
 * Раздел записи плагин не назначает — его называет место вызова `emit`.
 */
export const appOutbox = outbox({
  transaction: db.tx,
  store: outboxStore.token,
  operations: [UserCreated],
});

/**
 * Адаптер метрик: он же корень, под которым ядро считает запросы, и он же
 * узел графа, который читает endpoint `GET /metrics`.
 */
export const exporter = prometheusExporter();

/**
 * Переключатель состава: документация нужна в dev-контуре и не нужна за
 * периметром. Значение приходит аргументом сборки — `APP_DOCS`.
 */
export const Docs = makeSwitch('docs', { default: 'on' });

/**
 * Опции документа: одно значение для плагина и для скрипта `openapi.ts`.
 *
 * Второго `info` и второго списка конвертеров рядом не заводится: документ
 * из CI и документ по `GET /openapi.json` описывают одно API.
 */
export const openapiOptions: OpenApiOptions = {
  info: { title: 'Users API', version: '1.0.0' },
  converters: [zodConverter()],
};

/** Плагин документации: обе ветки переключателя видны статически */
export const appOpenapi = openapi({
  ...openapiOptions,
  pipeline: observability,
});

/**
 * Сервер приложения: сокетом владеет он, а не транспорт.
 *
 * Объявлен явно, потому что транспортов на этом сокете два. Порт и хост
 * сервер читает из своей секции — `HTTP_PORT` и `HTTP_HOST`.
 */
export const api = httpServer();

/**
 * Декларация приложения: одно значение для `main.ts` и для тестов.
 *
 * Политики проверяются на собранном графе до фазы INIT и до открытия
 * сокета. Слой сравнивается по ссылке.
 */
export const app = makeApp({
  features: [UsersFeature],
  plugins: [
    ops,
    db,
    outboxStore,
    appOutbox,
    inboxStore,
    appInbox,
    metricsPlugin(exporter),
    // Документ строится на фазе ASSEMBLE из тех же деклараций, которые
    // обслуживают запросы. При `docs=off` плагина в сборке нет целиком
    Docs.when(appOpenapi),
  ],
  switches: [Docs],
  // Два протокола на одном сокете: HTTP-endpoint'ы и сообщения MCP по
  // `POST /mcp`. Сервер объявлен отдельно и передан обоим транспортам;
  // второго слушателя не появляется
  transports: [
    api,
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'microservice', version: '1.0.0' },
      // Те же конвертеры, что у документа: схемы переводит один механизм
      converters: openapiOptions.converters,
    }),
  ],
  metrics: exporter,
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // И у каждого инструмента агента: слой объявляет декларация, а не
    // транспорт, поэтому проверяет его политика
    everyEndpoint({ transport: McpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Каждый endpoint, который меняет данные, проверяет Bearer-токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
    // Каждый endpoint, который меняет пользователей, обязан быть в
    // транзакции: без неё и запись пользователя, и транзакционный emit
    // падали бы на первом запросе, а не на сборке. Фильтр назван адресом:
    // административное завершение подписки — тоже DELETE, но данных оно
    // не пишет
    db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) \/users/ }),
    // Хранилище читает `requestId` из контекста запроса. Политика требует,
    // чтобы пайплайн эту переменную объявлял: иначе чтение вернуло бы
    // `undefined` на том маршруте, где слой забыли подключить
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
    // Каждый подписчик шины дедуплицирует доставку. Без слоя повтор
    // относился бы к обязанностям подписчика соглашением, а здесь это
    // проверка сборки: нарушение видно до открытия сокета
    appInbox.requiresInbox({ transport: BusTransport$ }, 'inbox'),
  ],
});
