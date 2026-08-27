import { OpsModule } from './modules/ops/ops.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { UsersModule } from './users.module';

import { makeFeature } from '@nestling/app';

/**
 * Эксплуатационная фича: ручки, обслуживающие не пользователя, а
 * инфраструктуру — liveness-проба и админ-плоскость подписок.
 *
 * Инфраструктурных фич по-прежнему нет: логирование и реестр подписок —
 * модули, которые фича **импортирует** (`ops.module.ts`), а не фичи, от
 * которых она зависит. Liveness-проба помечена `detached` и обходится без
 * слоя наблюдаемости; админским ручкам он нужен, как и любым другим, —
 * поэтому логгер в этой топологии в графе есть.
 */
export const OpsFeature = makeFeature({
  name: 'ops',
  modules: [OpsModule],
});

/**
 * Фича квот: владелец контрактов `quotas.claim` и подписчик
 * `users.registered`.
 *
 * Ни одного токена наружу она не отдаёт — общение с ней идёт контрактами.
 * Поэтому её можно увезти в отдельный процесс, не тронув фичу `users`:
 * поменяется биндинг на сборке, а не call-site.
 */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  modules: [QuotasModule],
});

/**
 * Фича пользователей.
 *
 * `dependsOn` — ссылка на **значение**, а не имя: выбрав `users`, получаем
 * и `ops`, даже если в `select` его не называли. Инфраструктура же
 * приезжает не через `dependsOn`, а импортом модуля (`users.module.ts`).
 *
 * `quotas` в `dependsOn` по другой причине: `users` зовёт её контрактом, а
 * `request` без co-located реализации — ошибка **сборки**. Топология
 * «users без quotas» в V1 не поднимается, и это видно на ASSEMBLE, а не
 * на первом запросе.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [OpsFeature, QuotasFeature],
});
