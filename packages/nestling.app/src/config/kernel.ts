/**
 * Фаза 0 конфига и kernel-модуль вокруг её результата.
 *
 * Корень регистрирует модуль **всегда**: если нужен только `process.env`,
 * в корне про конфиг не пишешь ничего. Без привязок читалка читает только
 * `process.env`, а рецепты не создают узел, пока никто не инжектит секцию.
 */

import { Config, ConfigSection } from './families.js';
import { projectSection } from './project.js';
import type { ConfigReaderOptions } from './reader.js';
import { ConfigReader } from './reader.js';
import { lookupSection } from './registry.js';
import type { ConfigBinding } from './source.js';

import type { Module } from '@nestling/container';
import { familyProvider, makeToken } from '@nestling/container';

/**
 * Приватный токен читалки: из `index.ts` не экспортируется, поэтому
 * инжектить её пользовательскому коду нечем — kernel-граница держится
 * видимостью ES-модулей, а не рантайм-проверкой.
 */
const ConfigReaderToken = makeToken<ConfigReader>('kernel:ConfigReader');

/** Опции kernel-модуля конфига */
export type ConfigKernelOptions = ConfigReaderOptions;

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
 * Выполняет фазу 0 BOOTSTRAP: поднимает привязанные источники и снимает
 * снимок объявленных ключей.
 *
 * Читалка создаётся вне контейнера — так граница фазы видна в коде: до
 * этого вызова ввод-вывод есть, после его нет. Порядок «источники раньше
 * секций» держит фаза, а не топология графа.
 *
 * @param bindings - Плоский список `[source, target]`; порядок = приоритет
 * @param options - Канал предупреждений
 * @returns Читалку со снятым снимком — её принимает {@link configKernel}
 * @throws {ConfigSourceError} Если `init()` источника отказал
 *
 * @example
 * ```typescript
 * const reader = await bootstrapConfig([
 *   [vault(), [ordersKeys]],
 *   [file('config.yaml'), ['*_URL']],
 * ]);
 *
 * builder.register(configKernel(reader));
 * ```
 */
export const bootstrapConfig = async (
  bindings: readonly ConfigBinding[] = [],
  options: ConfigKernelOptions = {},
): Promise<ConfigReader> => {
  const reader = new ConfigReader(bindings, options);
  await reader.init();

  return reader;
};

/**
 * Собирает kernel-модуль конфига вокруг готовой читалки.
 *
 * Читалка входит в граф значением: асинхронной фабрики у неё нет, потому
 * что источники подняты раньше — на фазе 0.
 *
 * @param reader - Результат {@link bootstrapConfig}
 *
 * @example
 * ```typescript
 * builder.register(configKernel(await bootstrapConfig(bindings)));
 * ```
 */
export const configKernel = (reader: ConfigReader): Module => ({
  name: 'kernel:config',
  providers: [
    {
      provide: ConfigReaderToken,
      useValue: reader,
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

/**
 * Тип читалки — тому, кто держит её живой на время `run()`.
 *
 * Только тип: конструктор наружу не выходит, поэтому создать читалку можно
 * единственным способом — вызвать {@link bootstrapConfig}.
 */
export { type ConfigReader } from './reader.js';
