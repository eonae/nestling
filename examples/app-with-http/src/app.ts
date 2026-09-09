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
} from '@nestling/app';
import { makeSwitch } from '@nestling/container';
import type { OpenApiOptions } from '@nestling/openapi';
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { subscriptions } from '@nestling/subscriptions';
import { http, httpProbes, HttpTransport$ } from '@nestling/transport.http';

/**
 * Декларация приложения: одно значение для `main.ts`, тестов и проверки
 * топологий. Экземпляры параметризованных плагинов создаются здесь один
 * раз.
 */

/**
 * Реестр подписок из пакета `@nestling/subscriptions`.
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
  // Сокетом владеет сервер: `http()` объявляет его сам, а порт и хост
  // сервер читает из своей секции — `HTTP_PORT`, `HTTP_HOST`
  transports: [http()],
  // Инварианты проверяются на собранном графе до фазы INIT и до открытия
  // сокета. Слой сравнивается по ссылке
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
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
