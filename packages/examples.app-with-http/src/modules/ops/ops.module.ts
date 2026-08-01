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
 * Эксплуатационный модуль: ручки, которые обслуживают не пользователя, а
 * инфраструктуру.
 *
 * Едет в любой топологии: приложение без liveness-пробы и без возможности
 * посмотреть, кто на нём висит, не поднимают ни в одном варианте деплоя.
 *
 * `imports:` — та же конвенция, что у модуля пользователей: инфраструктура
 * приезжает значением. Логирование нужно слою наблюдаемости (админские
 * ручки под теми же политиками, что и прикладные), реестр подписок — их
 * зависимостям и слою `tracked`.
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
