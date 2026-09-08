import {
  SubscriptionClosedInOps,
  SubscriptionOpenedInOps,
} from './subscription-facts.js';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './subscriptions.endpoint.js';

import { makeFeature } from '@nestling/app';

/**
 * Эксплуатационная фича: endpoint'ы для инфраструктуры, а не для
 * пользователя API.
 *
 * Своих провайдеров у неё нет. Логирование, аутентификация и реестр
 * подписок приходят плагинами и доступны DI-токенами. Пробы живости и
 * готовности сюда не входят: их даёт плагин `httpProbes()` в корне.
 */
export const OpsFeature = makeFeature({
  name: 'ops',
  providers: [],
  endpoints: [
    ListSubscriptions,
    KillSubscription,
    WatchSubscriptions,
    SubscriptionOpenedInOps,
    SubscriptionClosedInOps,
  ],
});
