import { Health } from './health.endpoint';
import {
  SubscriptionClosedInOps,
  SubscriptionOpenedInOps,
} from './subscription-facts';
import {
  KillSubscription,
  ListSubscriptions,
  WatchSubscriptions,
} from './subscriptions.endpoint';

import { makeFeature } from '@nestling/app';

/**
 * Эксплуатационная фича: endpoint'ы для инфраструктуры, а не для
 * пользователя API.
 *
 * Своих провайдеров у неё нет. Логирование, аутентификация и реестр
 * подписок приходят плагинами и доступны токенами.
 */
export const OpsFeature = makeFeature({
  name: 'ops',
  providers: [],
  endpoints: [
    Health,
    ListSubscriptions,
    KillSubscription,
    WatchSubscriptions,
    SubscriptionOpenedInOps,
    SubscriptionClosedInOps,
  ],
});
