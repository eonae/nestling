import { OpsModule } from './modules/ops/ops.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { UsersModule } from './users.module';

import { makeFeature } from '@nestling/app';

/**
 * Эксплуатационная фича: ручки, обслуживающие не пользователя, а
 * инфраструктуру (liveness-проба).
 *
 * Логирования в ней нет: сквозная инфраструктура — не фича, а модуль,
 * который импортирует тот, кому он нужен. Liveness-проба помечена
 * `detached`, поэтому слой наблюдаемости ей и не требуется — эта топология
 * поднимается вообще без логгера в графе.
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
