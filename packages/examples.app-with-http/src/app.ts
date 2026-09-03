import { OpsFeature } from './features/ops/ops.feature';
import { QuotasFeature } from './features/quotas/quotas.feature';
import { UsersFeature } from './features/users/users.feature';
import { appAuth, authed } from './plugins/auth';
import { logging, observability } from './plugins/logging';

import { makeApp } from '@nestling/app';
import { openapi } from '@nestling/openapi';
import { zodConverter } from '@nestling/openapi.zod';
import { everyEndpoint } from '@nestling/pipeline';
import { BusTransport$, IdempotencyKey } from '@nestling/ports';
import { subscriptions } from '@nestling/subscriptions';
import { http, HttpTransport$ } from '@nestling/transport.http';

/**
 * Декларация приложения: одно значение для `main.ts`, тестов и проверки
 * топологий. Экземпляры параметризованных плагинов создаются здесь один
 * раз.
 */

/** Логирование: имя сервиса задаётся здесь, уровень приходит из `LOG_LEVEL` */
export const appLogging = logging({ service: 'app-with-http' });

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

export const app = makeApp({
  features: [UsersFeature, QuotasFeature, OpsFeature],
  plugins: [
    appLogging,
    appAuth,
    appSubscriptions,
    // Документ строится на фазе ASSEMBLE из тех же деклараций, которые
    // обслуживают запросы
    openapi({
      info: { title: 'Users API', version: '1.0.0' },
      converters: [zodConverter()],
      pipeline: observability,
    }),
  ],
  // Порт и хост приходят из секции транспорта: `HTTP_PORT`, `HTTP_HOST`
  transports: [http()],
  // Инварианты проверяются на собранном графе до `@OnInit` и до открытия
  // сокета. Слой сравнивается по ссылке
  policies: [
    // У каждого HTTP-endpoint'а есть слой наблюдаемости
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    // Каждый endpoint, который меняет данные, проверяет токен
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
