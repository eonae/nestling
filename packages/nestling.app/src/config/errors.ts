import type { SchemaIssue } from '@nestlingjs/common.misc';

/** Текст, которым заменяется сообщение issue'а секретного поля */
export const REDACTED = '<redacted>';

/** Одно проваленное поле секции */
export interface ConfigFieldFailure {
  /** Имя поля в рекорде */
  readonly field: string;
  /** Имя ключа, который читался */
  readonly key: string;
  /** Нормализованные issues схемы поля */
  readonly issues: readonly SchemaIssue[];
  /**
   * Сообщения issue'ев отредактированы, потому что ключ секретен и значение
   * было задано.
   *
   * Взведён — значит в `issues[].message` лежит {@link REDACTED}, а не текст
   * вендора: `failures` — публичное поле, и логгер, дампнувший его, обязан
   * быть безопасен по построению.
   */
  readonly redacted: boolean;
}

/**
 * Секция не прошла валидацию.
 *
 * Отказ одного поля не прекращает проверку остальных: ошибка несёт **все**
 * проваленные поля секции разом — чинить конфиг по одному полю за перезапуск
 * не должно быть нужно. Перечень опрошенных источников назван здесь же:
 * «ключ не найден» без ответа на «где искали» бесполезно.
 */
export class ConfigValidationError extends Error {
  constructor(
    /** Префикс секции */
    readonly section: string,
    /** Проваленные поля в порядке объявления */
    readonly failures: readonly ConfigFieldFailure[],
    /** Источники, опрошенные читалкой, в порядке приоритета */
    readonly sources: readonly string[],
  ) {
    super(
      `Config section '${section}' is invalid:\n` +
        failures
          .map(
            (failure) =>
              `  - ${failure.key} (field '${failure.field}'): ` +
              failure.issues
                // Флаг, а не доверие к содержимому `issues`: редактирование
                // держится в обоих слоях независимо, поэтому ошибка,
                // собранная вручную, тоже безопасна.
                .map((issue) => (failure.redacted ? REDACTED : issue.message))
                .join('; '),
          )
          .join('\n') +
        `\nSources consulted, in priority order: ${sources.join(', ')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

/**
 * Функция вычисляемого поля бросила.
 *
 * Отдельная ошибка, а не запись в `failures` у {@link ConfigValidationError}:
 * та запись несёт имя ключа и нормализованные issues схемы, а у вычисляемого
 * поля нет ни ключа, ни схемы. Названы секция, поле и его зависимости —
 * искать причину нужно в них, а деталь отказа лежит в `cause`.
 */
export class ConfigDerivedError extends Error {
  constructor(
    /** Префикс секции */
    readonly section: string,
    /** Имя вычисляемого поля */
    readonly field: string,
    /** Имена полей-зависимостей в порядке объявления */
    readonly deps: readonly string[],
    /** Исходная ошибка функции поля */
    cause: unknown,
  ) {
    super(
      `Config section '${section}' failed to compute derived field ` +
        `'${field}' from [${deps.join(', ')}]: ` +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    );
    this.name = 'ConfigDerivedError';
  }
}

/** Один читатель ключа в тексте {@link ConfigSharedKeyError} */
export interface SharedKeyReader {
  /** Префикс секции */
  readonly section: string;
  /** Имя поля в её рекорде */
  readonly field: string;
  /** Секция объявлена `makeConfig.reloadable` */
  readonly reloadable: boolean;
}

/**
 * Общий ключ читают секции с разным флагом `reloadable`.
 *
 * Единственный настоящий конфликт общего ключа: схемы читателей независимы и
 * законно различаются, а вот «значение может измениться под ногами» —
 * свойство самого ключа, и согласовать его обязаны все читатели.
 *
 * Текст симметричен относительно порядка создания секций: читатели
 * перечисляются отсортированными по имени секции, и названы **обе** починки,
 * поэтому какая из секций спроецировалась второй, на сообщение не влияет.
 */
export class ConfigSharedKeyError extends Error {
  constructor(
    /** Имя конфликтного ключа */
    readonly key: string,
    /** Читатели ключа — ровно два: первый claim и тот, что с ним разошёлся */
    readonly readers: readonly SharedKeyReader[],
  ) {
    const sorted = [...readers].sort((a, b) =>
      a.section.localeCompare(b.section),
    );
    const reloadable = sorted.find((reader) => reader.reloadable);
    const plain = sorted.find((reader) => !reader.reloadable);

    super(
      `Config key '${key}' is read by sections with different 'reloadable' flags:\n` +
        sorted
          .map(
            (reader) =>
              `  - section '${reader.section}' (field '${reader.field}'): ` +
              (reader.reloadable ? 'reloadable' : 'not reloadable'),
          )
          .join('\n') +
        `\nA shared key has one value for all its readers, so «the value may change ` +
        `under your feet» must be agreed by all of them. Fix it either way: declare ` +
        `'${plain?.section}' with makeConfig.reloadable, or drop makeConfig.reloadable ` +
        `from '${reloadable?.section}'.`,
    );
    this.name = 'ConfigSharedKeyError';
  }
}

/**
 * Источник не поднялся на фазе 0.
 *
 * Ошибка называет источник по имени: «конфиг не прочитался» без ответа на
 * «какой источник» отправляет искать наугад. Исходная ошибка лежит в
 * `cause` — деталь отказа знает источник, а не ядро.
 *
 * Повторов ядро не делает: сколько раз и с какой паузой повторять, знает
 * источник, и объявляет это параметром своей фабрики.
 */
export class ConfigSourceError extends Error {
  constructor(
    /** Имя источника из привязки */
    readonly source: string,
    /** Исходная ошибка `init()` */
    cause: unknown,
  ) {
    super(
      `Config source '${source}' failed to initialize, so the application ` +
        `cannot start: phase 0 reads every bound source before the container ` +
        `is built. Retries belong to the source itself — declare them in its ` +
        `factory if the failure is transient.`,
      { cause },
    );
    this.name = 'ConfigSourceError';
  }
}

/**
 * Привязки ссылаются друг на друга полем `needs`.
 *
 * Дефект списка привязок, а не недоступность внешней системы: цепочку
 * некуда начать, поэтому первого источника для подъёма нет. Считается до
 * первого `init()`, и `optional` его не проглатывает — пропуск одной
 * привязки цикла оставил бы порядок таким же непостроимым.
 */
export class ConfigSourceCycleError extends Error {
  constructor(
    /** Имена источников цикла; первое имя повторено последним */
    readonly chain: readonly string[],
  ) {
    super(
      `Config sources depend on each other through 'needs': ` +
        `${chain.join(' -> ')}. Phase 0 raises a source after the bindings ` +
        `that cover the keys of its section, so a cycle has no source to ` +
        `start with. Break it: pass the coordinates of one source as a ` +
        `constructor argument, or narrow the 'keys' of its binding so that ` +
        `it stops covering the section of the other.`,
    );
    this.name = 'ConfigSourceCycleError';
  }
}

/** Почему секция `needs` непригодна для подъёма источника */
export type NeedsDeclarationFault = 'undeclared' | 'reloadable';

/**
 * Секция, объявленная источником в `needs`, не годится ему в координаты.
 *
 * Дефект объявления, а не недоступность внешней системы: секции либо нет в
 * реестре, либо она обещает перепроекцию, которой у координат не бывает.
 * Поэтому `optional` этот отказ не проглатывает — пропуск источника скрыл
 * бы опечатку в имени секции или неимпортированный модуль.
 */
export class ConfigNeedsDeclarationError extends Error {
  constructor(
    /** Имя источника из привязки */
    readonly source: string,
    /** Префикс секции, объявленной в `needs` */
    readonly section: string,
    /** Что именно не так с секцией */
    readonly fault: NeedsDeclarationFault,
  ) {
    super(
      `Config source '${source}' needs section '${section}', which ` +
        (fault === 'undeclared'
          ? `is not declared. Declare it with makeConfig('${section}', { … }) ` +
            `and make sure the module that declares it is imported: phase 0 ` +
            `reads the section by its declared keys.`
          : `is declared with makeConfig.reloadable. The section a source ` +
            `reads is projected once, before that source is raised, and is ` +
            `never projected again — declare it with makeConfig instead.`),
    );
    this.name = 'ConfigNeedsDeclarationError';
  }
}

/**
 * Секция координат не спроецировалась, поэтому источник поднять нечем.
 *
 * Названы источник, секция, ключи, значений которых не нашлось, и источники,
 * поднятые раньше него: искать пропажу нужно среди них, потому что читалка
 * спрашивала только их. Деталь отказа схемы лежит в `cause`.
 *
 * Значений в тексте нет — только имена ключей: секция координат несёт
 * секретные поля, а ошибка старта попадает в лог целиком.
 */
export class ConfigSourceNeedsError extends Error {
  constructor(
    /** Имя источника из привязки */
    readonly source: string,
    /** Префикс секции, объявленной в `needs` */
    readonly section: string,
    /** Ключи секции, значения которых не нашлись */
    readonly missing: readonly string[],
    /** Источники, поднятые раньше, в порядке приоритета */
    readonly sources: readonly string[],
    /** Исходная ошибка проекции */
    cause: unknown,
  ) {
    super(
      `Config source '${source}' cannot be raised: its section '${section}' ` +
        `did not project.\n` +
        (missing.length > 0
          ? `  - keys with no value: ${missing.join(', ')}\n`
          : `  - every key has a value, so a field schema rejected one of ` +
            `them; the failure is in 'cause'\n`) +
        `Sources raised before it, in priority order: ${
          sources.length > 0 ? sources.join(', ') : '(none)'
        }`,
      { cause },
    );
    this.name = 'ConfigSourceNeedsError';
  }
}
