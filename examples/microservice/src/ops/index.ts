/**
 * Эксплуатационная поверхность сервиса: версия сборки, пробы, реестр
 * подписок. Всё это есть в каждом процессе и в выборе фич не участвует,
 * поэтому приходит плагином, а не фичей.
 */

export { BuildInfo } from './build-info.endpoint.js';
export { appSubscriptions, ops } from './ops.plugin.js';
export {
  KillSubscription,
  ListSubscriptions,
  SubscriptionNotFound,
  WatchSubscriptions,
} from './subscriptions.endpoint.js';
