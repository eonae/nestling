import { AppModule } from './app.feature';
import { appConfigKeys } from './config';
import { appLogging } from './logging';
import { runtimeConfigKeys } from './runtime';

import type { ConfigSource } from '@nestling/config';
import { configKernel, objectSource } from '@nestling/config';
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
        [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
        [runtime, runtimeConfigKeys],
      ]),
    )
    .register(...appLogging.modules)
    .register(AppModule)
    .build();
};
