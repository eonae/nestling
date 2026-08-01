/**
 * `@nestling/subscriptions` — реестр активных подписок.
 *
 * Satellite-пакет: ни строки в ядре. Всё, из чего он собран, — публичные
 * примитивы: фазы `.pre`/`.finally` и класс-форма юнита
 * (`@nestling/pipeline`), `AbortSignal`, DI (`@nestling/container`),
 * `Topic` (`@nestling/streams`) и контракты (`@nestling/contracts`).
 *
 * Наружу уходят четыре вещи: реестр (токен и его API), слой `tracked`,
 * фабрика модуля и типы модели — плюс два `event`-контракта, которыми
 * пакет публикует факты жизненного цикла.
 *
 * Внутри остаются класс-юниты слоя (`TrackSubscription`/
 * `UntrackSubscription`): их регистрирует модуль, и никакой другой код с
 * ними не работает — граница держится видимостью ES-модулей, а не
 * рантайм-проверкой.
 */

export { SubscriptionClosed, SubscriptionOpened } from './contracts.js';
export type {
  SubscriptionClosedFact,
  SubscriptionOpenedFact,
} from './contracts.js';
export { SubscriptionKilledError } from './errors.js';
export { tracked } from './layer.js';
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
