import { ops } from './ops/index.js';
import { authed } from './auth.js';
import { metricsPlugin, prometheusExporter } from './metrics.js';
import { traced } from './observability.js';
import { db } from './persistence.js';
import { UsersFeature } from './users.feature.js';

import { everyEndpoint, makeApp, RequestId } from '@nestlingjs/app';
import { makeSwitch } from '@nestlingjs/container';
import { mcp, McpTransport$ } from '@nestlingjs/mcp';
import { makeOpenapi } from '@nestlingjs/openapi';
import { http, HttpTransport$, server } from '@nestlingjs/transport.http';

/**
 * Адаптер метрик: он же корень, под которым ядро считает запросы, и он же
 * узел графа, который читает endpoint `GET /metrics`.
 */
export const exporter = prometheusExporter();

/**
 * Переключатель состава: документация нужна в dev-контуре и не нужна за
 * периметром. Значение приходит аргументом сборки — `APP_DOCS`.
 */
export const DocsEnabled = makeSwitch('docs', { default: 'on' });

/**
 * Плагин документации: обе ветки переключателя видны статически.
 *
 * Опции документа объявлены здесь и только здесь: скрипт `openapi.ts`
 * строит документ методом этого же значения, поэтому второго `info` рядом
 * не заводится. Конвертер схем не назван — схемы приложения написаны на
 * вендоре фреймворка, и его конвертер подставляется умолчанием.
 */
export const openapi = makeOpenapi({
  info: { title: 'Users API', version: '1.0.0' },
  pipeline: traced,
});

/**
 * Сервер приложения: сокетом владеет он, а не транспорт.
 *
 * Объявлен явно, потому что транспортов на этом сокете два. Порт и хост
 * сервер читает из своей секции — `HTTP_PORT` и `HTTP_HOST`.
 */
export const api = server();

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
    metricsPlugin(exporter),
    // Документ строится на фазе BUILD из тех же деклараций, которые
    // обслуживают запросы. При `docs=off` плагина в сборке нет целиком
    DocsEnabled.when(openapi),
  ],
  switches: [DocsEnabled],
  // Два протокола на одном сокете: HTTP-endpoint'ы и сообщения MCP по
  // `POST /mcp`. Сервер объявлен отдельно и передан обоим опцией `server`;
  // в списке транспортов его нет, а сокет остаётся один
  transports: [
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'microservice', version: '1.0.0' },
    }),
  ],
  metrics: exporter,
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      traced,
      'traced',
    ),
    // И у каждого инструмента агента: слой объявляет декларация, а не
    // транспорт, поэтому проверяет его политика
    everyEndpoint({ transport: McpTransport$('default') }).hasLayer(
      traced,
      'traced',
    ),
    // Каждый endpoint, который меняет данные, проверяет Bearer-токен
    everyEndpoint({ pattern: /^(POST|PATCH|DELETE) / }).hasLayer(
      authed,
      'authed',
    ),
    // Каждый endpoint, который меняет пользователей, обязан быть в
    // транзакции: без неё запись падала бы на первом запросе, а не на
    // сборке. Фильтр назван адресом: административное завершение подписки
    // — тоже DELETE, но данных оно не пишет
    db.requiresTransaction({ pattern: /^(POST|PATCH|DELETE) \/users/ }),
    // Хранилище читает `requestId` из контекста запроса. Политика требует,
    // чтобы пайплайн эту переменную объявлял: иначе чтение вернуло бы
    // `undefined` на том маршруте, где слой забыли подключить
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
});
