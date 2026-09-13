import { BuildInfo } from './build-info.endpoint.js';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './subscriptions.endpoint.js';

import { makePlugin } from '@nestlingjs/app';
import { subscriptions } from '@nestlingjs/subscriptions';
import { httpProbes } from '@nestlingjs/transport.http';

/**
 * Реестр подписок из пакета `@nestlingjs/subscriptions`.
 *
 * `identity` и `labels` вычисляются из контекста запроса: что считать
 * подписчиком, решает приложение. `publish: false` — фактов открытия и
 * закрытия в шину не уходит: процесс один, и реестр этого процесса виден
 * целиком через `GET /ops/subscriptions`.
 */
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: false,
});

/**
 * Плагин эксплуатации: служебные endpoint'ы, которые есть в каждом
 * процессе. Плагин подключён всегда и в выборе фич не участвует.
 *
 * Пробы живости и готовности он не пишет сам: их даёт `httpProbes()`
 * поверх узла ядра `Health$`. Реестр подписок приходит тем же способом —
 * плагином, от которого зависит этот.
 */
export const ops = makePlugin({
  name: 'ops',
  endpoints: [
    BuildInfo,
    ListSubscriptions,
    KillSubscription,
    WatchSubscriptions,
  ],
  dependsOn: [httpProbes(), appSubscriptions],
});
