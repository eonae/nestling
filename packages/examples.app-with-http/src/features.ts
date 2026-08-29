import { OpsModule } from './modules/ops/ops.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { UsersModule } from './users.module';

import { makeFeature } from '@nestling/app';

/**
 * Эксплуатационная фича: endpoint'ы для инфраструктуры, а не для
 * пользователя — liveness-проба и административные endpoint'ы подписок.
 *
 * Логирование и реестр подписок — не фичи, а модули, которые эта фича
 * импортирует (`ops.module.ts`). Liveness-проба помечена `detached` и
 * работает без слоя наблюдаемости; административным endpoint'ам слой
 * нужен, поэтому логгер в этой топологии есть в графе.
 */
export const OpsFeature = makeFeature({
  name: 'ops',
  modules: [OpsModule],
});

/**
 * Фича квот: реализует контракт `quotas.claim` и подписана на событие
 * `users.registered`.
 *
 * Токенов наружу фича не экспортирует: другие фичи общаются с ней только
 * через контракты. Поэтому её можно вынести в отдельный процесс, не меняя
 * код фичи `users`: изменится привязка портов на сборке, а не вызовы.
 */
export const QuotasFeature = makeFeature({
  name: 'quotas',
  modules: [QuotasModule],
});

/**
 * Фича пользователей.
 *
 * `dependsOn` принимает значения фич, а не имена: при `select: 'users'`
 * в сборку попадут и `ops`, и `quotas`. Инфраструктура (логирование)
 * подключается не через `dependsOn`, а импортом модуля в
 * `users.module.ts`.
 *
 * `quotas` стоит в `dependsOn`, потому что `users` вызывает её контракт
 * вида `request`, а `request` без реализации в том же процессе — ошибка
 * сборки. Топология «users без quotas» не поднимется, и это видно на фазе
 * ASSEMBLE, а не на первом запросе.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [OpsFeature, QuotasFeature],
});
