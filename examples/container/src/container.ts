import { appConfigKeys } from './config/index.js';
import { appLogging } from './logging/index.js';
import { runtimeConfigKeys } from './runtime/index.js';
import { AppModule } from './app.feature.js';

import type { ConfigSource } from '@nestling/app';
import { bootstrapConfig, configKernel, objectSource } from '@nestling/app';
import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';

/**
 * Сборка контейнера без приложения: тот же граф, что собирает `main.ts`
 * через `assemble`. Используется скриптом экспорта графа (`cli.ts`) и
 * тестами, которым нужен доступ к инстансам.
 *
 * Фазы здесь ровно две и они разделены явно: `bootstrapConfig` поднимает
 * источники (фаза 0, единственный ввод-вывод), `build()` собирает граф
 * синхронно (фаза 1).
 *
 * @param runtime - Источник секции `runtime`; тест передаёт сюда объект,
 * который потом меняет
 */
export const makeContainer = async (
  runtime: ConfigSource = objectSource({}, 'runtime'),
): Promise<BuiltContainer> => {
  const config = await bootstrapConfig([
    [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
    [runtime, runtimeConfigKeys],
  ]);

  return new ContainerBuilder()
    .register(configKernel(config))
    .register(...appLogging.modules)
    .register(AppModule)
    .build();
};
