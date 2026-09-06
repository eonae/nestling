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
 * Ключ → его читатели, в порядке объявления секций.
 *
 * Инкрементальный индекс, а не пересчёт по `sections` на каждый вопрос:
 * `isSecretKey()` зовётся на каждый провалившийся отказ и на установку
 * display-хуков каждой секции, а перебор всех полей всех секций ради булева
 * ответа — лишняя работа с той же семантикой.
 */
const readers = new Map<string, ConfigKeyReader[]>();

/** Ключи, которые **хотя бы один** объявленный читатель пометил секретными */
const secretKeys = new Set<string>();

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

  for (const field of declaration.fields) {
    const existingReaders = readers.get(field.key) ?? [];

    existingReaders.push(
      Object.freeze({
        section: declaration.prefix,
        field: field.name,
        exact: field.exact,
        reloadable: declaration.reloadable,
        secret: field.secret,
      }),
    );
    readers.set(field.key, existingReaders);

    if (field.secret) {
      secretKeys.add(field.key);
    }
  }
};

/**
 * Секретен ли ключ — объединение по **объявленным** читателям.
 *
 * Считается по объявленным, а не по потреблённым графом секциям: снимок
 * реестра обязан работать в артефактное время, когда графа не существует, а
 * редактирование ошибается в безопасную сторону — лишний `***` не стоит
 * ничего, недо-редактирование стоит утечки.
 *
 * Наружу из пакета не экспортируется: потребителю хватает флага `secret`
 * в снимке `describeConfig()`.
 *
 * @internal
 */
export const isSecretKey = (key: string): boolean => secretKeys.has(key);

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
  /**
   * Ключ секретен — **эффективно**, то есть с учётом всех его читателей.
   *
   * У секции, объявившей ключ без `secret()`, флаг всё равно взведён, если
   * пометил его кто-то другой: секретность — свойство ключа, а не объявления.
   */
  readonly secret: boolean;
}

/** Один читатель ключа в key-центричном индексе снимка */
export interface ConfigKeyReader {
  /** Префикс секции-читателя */
  readonly section: string;
  /** Имя поля в её рекорде */
  readonly field: string;
  /** Имя ключа задано `from()`, а не выведено из префикса */
  readonly exact: boolean;
  /** Секция объявлена `makeConfig.reloadable` */
  readonly reloadable: boolean;
  /** **Это** объявление пометило поле `secret()` */
  readonly secret: boolean;
}

/**
 * Описание ключа в key-центричном индексе: сам ключ, его эффективная
 * секретность и все объявленные читатели.
 *
 * `readers.length > 1` и означает «ключ общий». Ключевого флага `reloadable`
 * здесь нет намеренно: до проверки согласованности на сборке он может быть
 * противоречив, и честный ответ принадлежит каждому читателю отдельно.
 */
export interface ConfigSharedKeyDescription {
  readonly key: string;
  readonly secret: boolean;
  readonly readers: readonly ConfigKeyReader[];
}

/** Описание секции в снимке реестра */
export interface ConfigSectionDescription {
  readonly prefix: string;
  readonly reloadable: boolean;
  /** Секция инжектнута кем-то и потому создана графом */
  readonly consumed: boolean;
  readonly keys: readonly ConfigKeyDescription[];
}

/** Снимок реестра: без значений и без сети */
export interface ConfigDescription {
  readonly sections: readonly ConfigSectionDescription[];
  /** Key-центричный индекс: те же данные, вопрос «кто читает этот ключ» */
  readonly keys: readonly ConfigSharedKeyDescription[];
  readonly globs: readonly ConfigGlob[];
}

/**
 * Снимок реестра объявлений: секции, их ключи, флаг `reloadable`,
 * key-центричный индекс читателей, объявленные unbound-глобы.
 *
 * Значений ключей в снимке нет и обращения к источникам он не требует.
 * Две проекции одних данных обслуживают два разных запроса: «что читает эта
 * секция» (`sections`) и «кто читает этот ключ» (`keys`).
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
            secret: isSecretKey(field.key),
          }),
        ),
      }),
    ),
    keys: [...readers.entries()].map(([key, keyReaders]) =>
      Object.freeze({
        key,
        secret: isSecretKey(key),
        readers: [...keyReaders],
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
  readers.clear();
  secretKeys.clear();
};
