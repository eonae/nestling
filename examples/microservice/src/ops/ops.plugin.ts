import { BuildInfo } from './build-info.endpoint.js';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './subscriptions.endpoint.js';

import { makePlugin, RequestId } from '@nestlingjs/app';
import { makeSubscriptions } from '@nestlingjs/subscriptions';
import { makeHttpProbes } from '@nestlingjs/transport.http';

/**
 * Реестр подписок из пакета `@nestlingjs/subscriptions`.
 *
 * Подписанта называет переменная `RequestId`: реестр читает её значение
 * по ключу, а формы накопленного входа не знает. Что переменную кладёт
 * каждый HTTP-endpoint, требует политика `hasVar` в `app.ts` — промах
 * ловится на сборке, а не пустым `identity` в списке подписок.
 *
 * `publish: false` — фактов открытия и закрытия в шину не уходит: процесс
 * один, и реестр этого процесса виден целиком через
 * `GET /ops/subscriptions`.
 */
export const subscriptions = makeSubscriptions({
  identity: RequestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: false,
});

/**
 * Плагин эксплуатации: служебные endpoint'ы, которые есть в каждом
 * процессе. Плагин подключён всегда и в выборе фич не участвует.
 *
 * Пробы живости и готовности он не пишет сам: их даёт `makeHttpProbes()`
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
  dependsOn: [makeHttpProbes(), subscriptions],
});
