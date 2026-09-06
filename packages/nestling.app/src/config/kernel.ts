/**
 * Kernel-модуль конфига: читалка и рецепты двух семейств.
 *
 * Корень регистрирует его **всегда**: если нужен только `process.env`, в
 * корне про конфиг не пишешь ничего. Без привязок читалка читает только
 * `process.env`, а рецепты не создают узел, пока никто не инжектит секцию.
 */

import { Config, ConfigSection } from './families.js';
import { projectSection } from './project.js';
import { ConfigReader } from './reader.js';
import { lookupSection } from './registry.js';
import type { ConfigBinding } from './source.js';

import type { Module } from '@nestling/container';
import { familyProvider, makeToken } from '@nestling/container';

/**
 * Приватный токен читалки: из `index.ts` не экспортируется, поэтому
 * инжектить её пользовательскому коду нечем — kernel-граница держится
 * видимостью ES-модулей, а не рантайм-проверкой.
 *
 * @internal Сборка приложения берёт по нему читалку после `build()`, чтобы
 * подключить логгер (`attachLogger`)
 */
export const ConfigReaderToken = makeToken<ConfigReader>('kernel:ConfigReader');

/**
 * Находит декларацию по префиксу и проецирует секцию.
 *
 * Отсутствие декларации означает, что токен секции пришёл из другого
 * процесса сборки (или реестр был сброшен) — называем префикс, а не
 * «member not found».
 */
const materializeSection = (prefix: string, reader: ConfigReader): unknown => {
  const declaration = lookupSection(prefix);

  if (!declaration) {
    throw new Error(
      `Config section '${prefix}' is injected but not declared. Declare it with makeConfig('${prefix}', { … }) and make sure the module that declares it is imported.`,
    );
  }

  declaration.consumed = true;

  return projectSection(declaration, reader);
};

/**
 * Собирает kernel-модуль конфига.
 *
 * @param bindings - Плоский список `[source, target]`; порядок = приоритет
 *
 * @example
 * ```typescript
 * configKernel([
 *   [vault(), [ordersKeys]],
 *   [file('config.yaml'), ['*_URL']],
 * ]);
 * ```
 */
export const configKernel = (
  bindings: readonly ConfigBinding[] = [],
): Module => ({
  name: 'kernel:config',
  providers: [
    {
      provide: ConfigReaderToken,
      // Асинхронная фабрика: `instantiateAll` её дожидается, а порядок
      // инстанцирования делает `init()` источников гарантированно более
      // ранним, чем проекция любой секции.
      useFactory: async () => {
        const reader = new ConfigReader(bindings);
        await reader.init();

        return reader;
      },
      deps: [],
    },
    familyProvider(ConfigSection, (prefix) => ({
      provide: ConfigSection(prefix),
      useFactory: (reader: ConfigReader) => materializeSection(prefix, reader),
      deps: [ConfigReaderToken],
    })),
    familyProvider(Config, (key) => ({
      provide: Config(key),
      useFactory: (reader: ConfigReader) => reader.read(key),
      deps: [ConfigReaderToken],
    })),
  ],
});
