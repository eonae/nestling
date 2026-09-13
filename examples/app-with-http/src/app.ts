import { OpsFeature } from './features/ops/ops.feature.js';
import { QuotasFeature } from './features/quotas/quotas.feature.js';
import { UsersFeature } from './features/users/users.feature.js';
import { appAuth, authed } from './plugins/auth/index.js';
import {
  appObservability,
  observability,
} from './plugins/observability/index.js';

import {
  BusTransport$,
  everyEndpoint,
  IdempotencyKey,
  makeApp,
} from '@nestlingjs/app';
import { makeSwitch } from '@nestlingjs/container';
import { mcp, McpTransport$ } from '@nestlingjs/mcp';
import type { OpenApiOptions } from '@nestlingjs/openapi';
import { openapi } from '@nestlingjs/openapi';
import { zodConverter } from '@nestlingjs/schema.zod';
import { subscriptions } from '@nestlingjs/subscriptions';
import {
  http,
  httpProbes,
  HttpTransport$,
  server,
} from '@nestlingjs/transport.http';

/**
 * Декларация приложения: одно значение для `main.ts`, тестов и проверки
 * топологий. Экземпляры параметризованных плагинов создаются здесь один
 * раз.
 */

/**
 * Реестр подписок из пакета `@nestlingjs/subscriptions`.
 *
 * `identity` и `labels` вычисляются из контекста запроса: что считать
 * подписчиком, решает приложение. `publish: true` включает публикацию
 * фактов открытия и закрытия событиями; их слушает фича `ops`.
 */
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});

/**
 * Переключатель состава: документация нужна в dev-контуре и не нужна за
 * периметром. Значение приходит аргументом сборки — `APP_DOCS`.
 */
export const Docs = makeSwitch('docs', { default: 'on' });

/**
 * Опции документа: одно значение для плагина и для скрипта `src/openapi.ts`.
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
 * Объявлен явно, потому что транспортов на этом сокете два: каждый
 * получает это объявление опцией `server`. Порт и хост сервер читает из
 * своей секции — `HTTP_PORT` и `HTTP_HOST`.
 */
export const api = server();

export const app = makeApp({
  features: [UsersFeature, QuotasFeature, OpsFeature],
  plugins: [
    appObservability,
    appAuth,
    appSubscriptions,
    // Пробы `GET /healthz` и `GET /readyz` поверх узла ядра `Health$`:
    // правило готовности принадлежит ядру, плагину — только адреса и коды
    httpProbes(),
    // Документ строится на фазе ASSEMBLE из тех же деклараций, которые
    // обслуживают запросы. При `docs=off` плагина в сборке нет целиком
    Docs.when(appOpenapi),
  ],
  switches: [Docs],
  // Два протокола на одном сокете: HTTP-endpoint'ы и сообщения MCP по
  // `POST /mcp`. Сервер передан обоим транспортам, в списке не
  // перечисляется; второго слушателя не появляется
  transports: [
    http({ server: api }),
    mcp({
      server: api,
      info: { name: 'users-service', version: '1.0.0' },
      // Те же конвертеры, что у документа: схемы переводит один механизм
      converters: openapiOptions.converters,
    }),
  ],
  // Инварианты проверяются на собранном графе до фазы INIT и до открытия
  // сокета. Слой сравнивается по ссылке
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
    everyEndpoint({
      transport: HttpTransport$('default'),
      pattern: /^(POST|PATCH|DELETE) /,
    }).hasLayer(authed, 'authed'),
    // Реализация команды регистрации кладёт ключ идемпотентности в
    // контекст: сервис в глубине графа читает его через `Ctx`
    everyEndpoint({
      transport: BusTransport$,
      pattern: /^quotas\.record-signup$/,
    }).hasVar(IdempotencyKey, 'idempotencyKey'),
  ],
});
