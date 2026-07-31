import { Health } from './health.endpoint';

import { makeAppModule } from '@nestling/app';

/**
 * Эксплуатационный модуль: ручки, которые обслуживают не пользователя, а
 * инфраструктуру.
 *
 * Живёт в инфраструктурной фиче `logging`, поэтому едет в любой топологии:
 * приложение без liveness-пробы не поднимают ни в одном варианте деплоя.
 */
export const OpsModule = makeAppModule({
  name: 'module:ops',
  endpoints: [Health],
});
