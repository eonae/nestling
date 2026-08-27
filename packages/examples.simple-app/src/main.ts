import { AppModule } from './app.module';
import { appConfigKeys } from './config';
import { Demo } from './demo';
import { LoggingModule } from './logging';

import { assemble } from '@nestling/app';
import { objectSource } from '@nestling/config';

/**
 * Композиционный корень: `assemble` — единственная публичная сборка.
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
 * конфиг в корне писать нечего: kernel-машинерия конфига регистрируется
 * всегда.
 *
 * Транспортов у примера нет — это легально: приложение проходит фазы и
 * остаётся в RUN. Сама демонстрация живёт в `@OnStart` провайдера `Demo`:
 * под `assemble` контейнер не является публичной поверхностью, и «достать
 * инстанс в корне» больше не способ.
 */
export async function main() {
  const app = assemble({
    modules: [LoggingModule, AppModule],
    providers: [Demo],
    config: [
      [objectSource({ APP_LOG_LEVEL: 'debug' }, 'defaults'), appConfigKeys],
    ],
  });

  await app.run();
  await app.close();
}

// eslint-disable-next-line no-console
main().catch(console.error);
