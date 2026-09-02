import { AppModule } from './app.feature';
import { appConfigKeys } from './config';
import { appLogging } from './logging';

import { configKernel, objectSource } from '@nestling/config';
import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';

/**
 * Композиционный корень.
 *
 * Здесь показаны два источника конфига:
 *
 * - **привязка источника** — объектный источник отдаёт `APP_LOG_LEVEL`;
 *   привязан к ключам `appConfigKeys`, то есть опрашивается только для
 *   ключей этой секции и ни для каких других;
 * - **чтение из env** — `DATABASE_URL` в списке источников не упомянут,
 *   но приходит из `process.env`: этот источник подключён всегда, с
 *   низшим приоритетом, и объявлять его не нужно.
 *
 * Порядок списка задаёт приоритет источников. Приложению, которому
 * хватает env, про конфиг в корне писать нечего: `configKernel()` без
 * привязок тривиален, а `App` регистрирует его сам.
 */
export const makeContainer = async (): Promise<BuiltContainer> => {
  return await new ContainerBuilder()
    .register(
      configKernel([
        [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
      ]),
    )
    // Контейнер используется автономно, без `App`: единицы слоя приложения
    // ему не нужны, а их модули — обычные значения
    .register(...appLogging.modules)
    .register(AppModule)
    .build();
};
