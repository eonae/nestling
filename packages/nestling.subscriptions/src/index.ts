/**
 * `@nestling/subscriptions` — реестр активных подписок.
 *
 * Satellite-пакет: ни строки в ядре. Всё, из чего он собран, — публичные
 * примитивы: фазы `.pre`/`.finally` и класс-форма юнита
 * (`@nestling/pipeline`), `AbortSignal`, DI (`@nestling/container`),
 * `Topic` (`@nestling/streams`) и операции (`@nestling/operations`).
 *
 * Наружу уходят четыре вещи: реестр (токен и его API), слой `tracked`,
 * фабрика модуля и типы модели — плюс два `event`-операции, которыми
 * пакет публикует факты жизненного цикла.
 *
 * Класс-юниты слоя (`TrackSubscription`/`UntrackSubscription`) тоже
 * экспортируются, но звать их руками не нужно: их регистрирует модуль.
 * Экспорт вынужденный и потому честный — класс-юнит попадает в `TNeeds`
 * слоя, а через него в тип декларации, композированной от `tracked`. Не
 * будь имени в публичной поверхности пакета, такая декларация в чужом
 * пакете не тайпчекалась бы («inferred type cannot be named», TS2742).
 */

export { SubscriptionClosed, SubscriptionOpened } from './operations.js';
export type {
  SubscriptionClosedFact,
  SubscriptionOpenedFact,
} from './operations.js';
export { SubscriptionKilledError } from './errors.js';
export { tracked, TrackSubscription, UntrackSubscription } from './layer.js';
export { subscriptions } from './module.js';
export type { SubscriptionsOptions } from './module.js';
export { SubscriptionRegistry } from './registry.js';
export type {
  CloseReason,
  SubscriptionEvent,
  SubscriptionFilter,
  SubscriptionInfo,
  SubscriptionKind,
  TrackedSubscription,
} from './types.js';
