import { OpsModule } from './modules/ops/ops.module';
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
 * Фича пользователей.
 *
 * `dependsOn` — ссылка на **значение**, а не имя: выбрав `users`, получаем
 * и `ops`, даже если в `select` его не называли. Инфраструктура же
 * приезжает не через `dependsOn`, а импортом модуля (`users.module.ts`).
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [OpsFeature],
});
