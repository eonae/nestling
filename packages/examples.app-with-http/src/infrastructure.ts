/**
 * Инфраструктура приложения.
 *
 * Плагина как примитива в ядре нет: cross-cutting оформляется обычным
 * параметризованным модулем. Значение создаётся здесь **один раз** и
 * импортируется теми, кому оно нужно, — так две фичи в одном процессе делят
 * один инстанс, а повторный вызов `logging({ … })` дал бы другое значение
 * под тем же именем и уронил бы сборку.
 */

import { logging } from './modules/logger';

import { subscriptions } from '@nestling/subscriptions';

/** Логирование приложения: имя сервиса — решение композиции, уровень — среды */
export const appLogging = logging({ service: 'app-with-http' });

/**
 * Реестр подписок — satellite-пакет, подключённый той же конвенцией.
 *
 * `identity` и `labels` — экстракторы из контекста запроса: **что** считать
 * подписантом, знает приложение, а не пакет. Здесь это `requestId`, который
 * кладёт слой наблюдаемости; в приложении с аутентификацией на его месте
 * стоял бы идентификатор пользователя.
 *
 * `publish: true` включает факты жизненного цикла контрактами: их слушает
 * фича `ops` (`modules/ops/subscription-facts.ts`). Цена включения —
 * публикация на каждой открытой и закрытой подписке, поэтому она opt-in.
 */
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});
