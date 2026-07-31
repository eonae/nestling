import { AppModule } from './app.module';
import { appConfigKeys } from './config';
import { LoggingModule } from './logging';

import { configKernel, objectSource } from '@nestling/config';
import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';

/**
 * Композиционный корень.
 *
 * Обе капли конфига видны здесь:
 *
 * - **привязка источника** — объектный источник отдаёт `APP_LOG_LEVEL`;
 *   привязан хэндлом `appConfigKeys`, то есть опрашивается только для
 *   ключей этой секции и ни для каких других;
 * - **чтение из env** — `DATABASE_URL` в списке не упомянут вовсе и
 *   приезжает из `process.env`: env — неявный пол, объявлять его нельзя
 *   и не нужно.
 *
 * Порядок списка = приоритет. Приложению, которому хватает env, про
 * конфиг в корне писать нечего: `configKernel()` без привязок тривиален,
 * а `App` регистрирует его сам.
 */
export const makeContainer = async (): Promise<BuiltContainer> => {
  return await new ContainerBuilder()
    .register(
      configKernel([
        [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
      ]),
    )
    .register(LoggingModule)
    .register(AppModule)
    .build();
};
