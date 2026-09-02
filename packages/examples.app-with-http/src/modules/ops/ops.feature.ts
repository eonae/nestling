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
 * пользователя.
 *
 * Входит в любую топологию: приложение без liveness-пробы и без списка
 * открытых подписок не разворачивают ни в одном варианте.
 *
 * Своих провайдеров у неё нет — только декларации. Логирование и реестр
 * подписок приходят плагинами: они есть в каждом процессе, и обращаются к
 * ним токенами.
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
