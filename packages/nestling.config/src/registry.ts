/**
 * Реестр объявлений — источник имён ключей для привязки и интроспекции.
 *
 * Значений здесь нет и не будет: снимок реестра пригоден для генерации
 * документации на этапе сборки артефактов, без обращения к источникам.
 */

import type { SectionDeclaration } from './declaration.js';
import type { ConfigGlob } from './keys.js';

/** Префикс → декларация */
const sections = new Map<string, SectionDeclaration>();

/** Объявленные пакетами unbound-глобы */
const globs = new Set<ConfigGlob>();

/**
 * Регистрирует объявление секции.
 *
 * Идемпотентен по идентичности декларации: повторная регистрация той же
 * записи (повторный импорт модуля) — не ошибка. Конфликтом считается
 * **другая** декларация с тем же префиксом.
 *
 * @throws {Error} Если префикс занят другой секцией
 */
export const registerSection = (declaration: SectionDeclaration): void => {
  const existing = sections.get(declaration.prefix);

  if (existing === declaration) {
    return;
  }

  if (existing) {
    throw new Error(
      `Config section prefix '${declaration.prefix}' is already declared. ` +
        `Existing section declares fields [${existing.fields
          .map((field) => field.name)
          .join(', ')}], the new one declares [${declaration.fields
          .map((field) => field.name)
          .join(
            ', ',
          )}]. Prefixes are the namespace of config keys — give one of the sections another prefix.`,
    );
  }

  sections.set(declaration.prefix, declaration);
};

/** Декларация секции по префиксу */
export const lookupSection = (prefix: string): SectionDeclaration | undefined =>
  sections.get(prefix);

/** Все объявленные ключи всех секций — против них сверяются таргеты привязок */
export const declaredKeys = (): readonly string[] =>
  [...sections.values()].flatMap((section) =>
    section.fields.map((field) => field.key),
  );

/**
 * Объявляет unbound-глоб: набор ключей, которых ни одна секция не называет.
 *
 * Пакет инфраструктуры экспортирует свой паттерн симметрично тому, как
 * секция экспортирует `.keys`, — корень привязывает его к источнику, а
 * `describeConfig()` показывает как объявленный.
 *
 * @param pattern - Глоб вроде `'*_GRPC_ADDRESS'`
 * @returns Тот же паттерн как таргет привязки
 *
 * @example
 * ```typescript
 * export const grpcAddressKeys = keysGlob('*_GRPC_ADDRESS');
 * ```
 */
export const keysGlob = (pattern: ConfigGlob): ConfigGlob => {
  globs.add(pattern);

  return pattern;
};

/** Описание одного ключа в снимке реестра */
export interface ConfigKeyDescription {
  /** Имя ключа */
  readonly key: string;
  /** Имя поля секции */
  readonly field: string;
  /** Имя задано `from()`, а не выведено из префикса */
  readonly exact: boolean;
}

/** Описание секции в снимке реестра */
export interface ConfigSectionDescription {
  readonly prefix: string;
  readonly reloadable: boolean;
  /** Секция инжектнута кем-то и потому материализована графом */
  readonly consumed: boolean;
  readonly keys: readonly ConfigKeyDescription[];
}

/** Снимок реестра: без значений и без сети */
export interface ConfigDescription {
  readonly sections: readonly ConfigSectionDescription[];
  readonly globs: readonly ConfigGlob[];
}

/**
 * Снимок реестра объявлений: секции, их ключи, флаг `reloadable`,
 * объявленные unbound-глобы.
 *
 * Значений ключей в снимке нет и обращения к источникам он не требует.
 */
export const describeConfig = (): ConfigDescription =>
  Object.freeze({
    sections: [...sections.values()].map((section) =>
      Object.freeze({
        prefix: section.prefix,
        reloadable: section.reloadable,
        consumed: section.consumed,
        keys: section.fields.map((field) =>
          Object.freeze({
            key: field.key,
            field: field.name,
            exact: field.exact,
          }),
        ),
      }),
    ),
    globs: [...globs],
  });

/**
 * Очищает реестр.
 *
 * Только для тестов пакета: реестр модульный, а jest даёт каждому файлу
 * свой module registry — сброс нужен внутри одного файла.
 *
 * @internal
 */
export const resetConfigRegistry = (): void => {
  sections.clear();
  globs.clear();
};
