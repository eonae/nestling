import { appConfigKeys } from './config/index.js';
import { appCounters } from './counters/index.js';
import { runtimeConfigKeys } from './runtime/index.js';
import { AppModule } from './app.feature.js';

import type { ConfigSource } from '@nestling/app';
import {
  configKernel,
  contextKernel,
  loggerKernel,
  objectSource,
} from '@nestling/app';
import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';

/**
 * Сборка контейнера без приложения: тот же граф, что собирает `main.ts`
 * через `assemble`. Используется скриптом экспорта графа (`cli.ts`) и
 * тестами, которым нужен доступ к инстансам.
 *
 * @param runtime - Источник секции `runtime`; тест передаёт сюда объект,
 * который потом меняет
 */
export const makeContainer = async (
  runtime: ConfigSource = objectSource({}, 'runtime'),
): Promise<BuiltContainer> => {
  return await new ContainerBuilder()
    .register(
      configKernel([
        [
          objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'),
          appConfigKeys,
        ],
        [runtime, runtimeConfigKeys],
      ]),
    )
    // Kernel-модули, которые `assemble` регистрирует сам: логгер ядра читает
    // секцию `nestlingLog` и идентификатор запроса из контекста
    .register(contextKernel(), loggerKernel())
    .register(...appCounters.modules)
    .register(AppModule)
    .build();
};
