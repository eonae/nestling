/**
 * Плагины приложения: логирование и реестр подписок.
 *
 * Сквозная инфраструктура — параметризованный плагин. Каждое значение
 * создаётся здесь один раз и перечисляется в `plugins:` корня. Повторный
 * вызов `logging({ … })` дал бы второе значение под тем же именем, и
 * сборка упала бы.
 */

import { logging } from './modules/logger';

import { subscriptions } from '@nestling/subscriptions';

/** Логирование: имя сервиса задаётся здесь, уровень — конфигом */
export const appLogging = logging({ service: 'app-with-http' });

/**
 * Реестр подписок: пакет `@nestling/subscriptions`, подключённый
 * плагином.
 *
 * `identity` и `labels` — функции от контекста запроса: что считать
 * подписантом, решает приложение. Здесь это `requestId`, который кладёт
 * слой наблюдаемости; в приложении с аутентификацией на его месте был бы
 * идентификатор пользователя.
 *
 * `publish: true` включает публикацию фактов открытия и закрытия подписок
 * операциями; их слушает фича `ops` (`modules/ops/subscription-facts.ts`).
 * По умолчанию публикация выключена: она стоит по одному событию на каждую
 * подписку.
 */
export const appSubscriptions = subscriptions({
  identity: (ctx) => (ctx.input as { requestId?: string }).requestId,
  labels: (ctx) => ({ transport: ctx.endpoint.transport }),
  publish: true,
  node: 'app-with-http',
});
