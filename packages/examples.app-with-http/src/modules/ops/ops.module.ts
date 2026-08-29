import { appLogging, appSubscriptions } from '../../infrastructure';

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

import { makeAppModule } from '@nestling/app';

/**
 * Эксплуатационный модуль: endpoint'ы для инфраструктуры, а не для
 * пользователя.
 *
 * Входит в любую топологию: приложение без liveness-пробы и без списка
 * открытых подписок не разворачивают ни в одном варианте.
 *
 * `imports:` подключает инфраструктуру значением, как и в модуле
 * пользователей. Логирование нужно слою наблюдаемости (административные
 * endpoint'ы подчиняются тем же политикам, что и прикладные), реестр
 * подписок — их зависимостям и слою `tracked`.
 */
export const OpsModule = makeAppModule({
  name: 'module:ops',
  imports: [appLogging, appSubscriptions],
  endpoints: [
    Health,
    ListSubscriptions,
    KillSubscription,
    WatchSubscriptions,
    SubscriptionOpenedInOps,
    SubscriptionClosedInOps,
  ],
});
