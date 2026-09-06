/**
 * Фаза 0 конфига и kernel-модуль вокруг её результата.
 *
 * Корень регистрирует модуль **всегда**: если нужен только `process.env`,
 * в корне про конфиг не пишешь ничего. Без привязок читалка читает только
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
 * Выполняет фазу 0 BOOTSTRAP: поднимает привязанные источники и снимает
 * снимок объявленных ключей.
 *
 * Читалка создаётся вне контейнера — так граница фазы видна в коде: до
 * этого вызова ввод-вывод есть, после его нет. Порядок «источники раньше
 * секций» держит фаза, а не топология графа.
 *
 * @param bindings - Плоский список `[source, target]`; порядок = приоритет
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
): Promise<ConfigReader> => {
  const reader = new ConfigReader(bindings);
  await reader.init();

  return reader;
};

/**
 * Проецирует объявленную секцию из снимка фазы 0, мимо графа.
 *
 * Нужна тому, что существует раньше первого узла: корневой логгер
 * создаётся до построения контейнера и читает свою секцию так же, как
 * прочитал бы её узел графа.
 *
 * @param prefix - Префикс секции
 * @param reader - Читалка со снимком фазы 0
 * @returns Проекция секции
 * @internal
 */
export const readSectionSnapshot = <T>(
  prefix: string,
  reader: ConfigReader,
): T => materializeSection(prefix, reader) as T;

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
    // Рецепты отдают провайдеры **значения**, а не фабрики: проекция
    // секции — это данные снимка фазы 0, а не экземпляр. Поэтому она
    // считается и валидируется на сборке, как и требует fail-fast, а
    // фаза INIT остаётся местом создания экземпляров
    familyProvider(ConfigSection, (prefix) => ({
      provide: ConfigSection(prefix),
      useValue: materializeSection(prefix, reader),
    })),
    familyProvider(Config, (key) => ({
      provide: Config(key),
      useValue: reader.read(key),
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
