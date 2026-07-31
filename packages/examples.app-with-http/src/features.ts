import { LoggerModule } from './modules/logger/logger.module';
import { UsersModule } from './users.module';

import { makeFeature } from '@nestling/app';

/**
 * Инфраструктурная фича: логгер, без которого не работает ни одна ручка
 * пользователей.
 *
 * Обычная фича, а не «плагин»: сквозное поведение оформляется модулем,
 * отдельного примитива в ядре нет.
 */
export const LoggingFeature = makeFeature({
  name: 'logging',
  modules: [LoggerModule],
});

/**
 * Фича пользователей.
 *
 * `dependsOn` — ссылка на **значение**, а не имя: выбрав `users`, получаем
 * и `logging`, даже если в `select` его не называли.
 */
export const UsersFeature = makeFeature({
  name: 'users',
  modules: [UsersModule],
  dependsOn: [LoggingFeature],
});
