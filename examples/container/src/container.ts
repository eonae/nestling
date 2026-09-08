import { appConfigKeys } from './config/index.js';
import { appCounters } from './counters/index.js';
import { runtimeConfigKeys } from './runtime/index.js';
import { AppModule } from './app.feature.js';

import type { ConfigSource } from '@nestling/app';
import {
  bootstrapConfig,
  configKernel,
  contextKernel,
  loggerKernel,
  makeKernelLogger,
  objectSource,
  registerHealth,
  RootLogger$,
} from '@nestling/app';
import type { BuiltContainer } from '@nestling/container';
import {
  ContainerBuilder,
  resolveBranches,
  valueProvider,
} from '@nestling/container';

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
    [objectSource({ APP_METRICS_PREFIX: 'demo' }, 'defaults'), appConfigKeys],
    [runtime, runtimeConfigKeys],
  ]);

  const builder = new ContainerBuilder()
    .register(configKernel(config))
    // Корневой логгер живёт вне графа: `makeApp` создаёт его на фазе 0 и
    // регистрирует значением сам, здесь это делает вызывающий код
    .register(valueProvider(RootLogger$, makeKernelLogger(config)))
    // Kernel-модули, которые `assemble` регистрирует сам: логгер ядра читает
    // секцию `nestlingLog` и идентификатор запроса из контекста
    .register(contextKernel(), loggerKernel())
    // Веток переключателей у примера нет, поэтому карта значений пуста
    .register(...resolveBranches(appCounters.modules, {}))
    .register(AppModule);

  // Пробы — после модулей: узел ядра называет каждый вклад поимённо.
  // Фазы здесь нет вовсе, поэтому её читалка отвечает RUN, как и в
  // тестовом прогоне
  registerHealth(builder, () => 'RUN');

  return builder.build();
};
