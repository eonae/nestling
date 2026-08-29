/**
 * Проекция секции: чтение ключей, независимая валидация полей, заморозка.
 */

import type { SectionDeclaration } from './declaration.js';
import type { ConfigFieldFailure } from './errors.js';
import { ConfigValidationError } from './errors.js';
import type { ConfigReader, Reloadable } from './reader.js';
import {
  defineDisplayHooks,
  secretFieldsOf,
  toFieldFailure,
} from './redact.js';

import { SchemaValidationError, validateSync } from '@common/misc';
import { Topic } from '@nestling/streams';

/** Значения секции — сырой рекорд до заморозки/обёртки геттерами */
type Values = Record<string, unknown>;

/**
 * Читает и валидирует все поля секции.
 *
 * Валидация независима по полям: отказ одного не прекращает проверку
 * остальных, и все отказы попадают в одну ошибку. Отсутствие значения не
 * является отдельным видом отказа — читалка отдаёт `undefined`, решает
 * схема поля (`default`/`optional` — валидно, иначе обычный issue).
 */
const readValues = (
  declaration: SectionDeclaration,
  reader: ConfigReader,
): Values => {
  const values: Values = {};
  const failures: ConfigFieldFailure[] = [];

  for (const field of declaration.fields) {
    const rawValue = reader.read(field.key);

    try {
      values[field.name] = validateSync(
        field.schema,
        rawValue,
        `Config key ${field.key} is invalid`,
      );
    } catch (error) {
      // Не-`SchemaValidationError` — ошибка конфигурации приложения
      // (async-refinement, объект-не-схема): её незачем складывать в
      // перечень проваленных полей, она чинится в другом месте.
      if (!(error instanceof SchemaValidationError)) {
        throw error;
      }

      failures.push(toFieldFailure(field, rawValue, error.issues));
    }
  }

  if (failures.length > 0) {
    throw new ConfigValidationError(
      declaration.prefix,
      failures,
      reader.sources,
    );
  }

  return values;
};

/**
 * Проекция reloadable-секции: геттеры поверх приватного снапшота.
 *
 * Инстанс стабилен — обновление меняет снапшот, а не объект: ссылка,
 * захваченная в конструкторе потребителя, продолжает указывать на
 * актуальные значения.
 */
class ReloadableSection implements Reloadable {
  readonly #declaration: SectionDeclaration;
  readonly #reader: ConfigReader;
  readonly #topic = new Topic<unknown>({ buffer: 1 });

  #snapshot: Values;

  /** Объект, который получает потребитель */
  readonly view: unknown;

  constructor(declaration: SectionDeclaration, reader: ConfigReader) {
    this.#declaration = declaration;
    this.#reader = reader;
    this.#snapshot = readValues(declaration, reader);
    this.view = this.#makeView();
  }

  /** Ключи секции — читалке для проверки способности источников */
  get keys(): readonly string[] {
    return this.#declaration.fields.map((field) => field.key);
  }

  /** Число живых подписок `onChange` @internal */
  get subscribers(): number {
    return this.#topic.subscribers;
  }

  /**
   * Перечитывает секцию целиком.
   *
   * Асимметрия со стартом: невалидное горячее значение не роняет процесс —
   * снапшот остаётся last-good, подписчики не вызываются, уходит warn.
   * Частичного применения не бывает: снапшот заменяется только целиком.
   */
  refresh(): void {
    let next: Values;

    try {
      next = readValues(this.#declaration, this.#reader);
    } catch (error) {
      this.#reader.warn(
        `keeping last known good values of reloadable config section '${this.#declaration.prefix}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return;
    }

    this.#snapshot = next;
    this.#topic.push(this.view);
  }

  #makeView(): unknown {
    const view: Record<string, unknown> = {};

    for (const field of this.#declaration.fields) {
      Object.defineProperty(view, field.name, {
        get: () => this.#snapshot[field.name],
        enumerable: true,
      });
    }

    Object.defineProperty(view, 'onChange', {
      value: (signal: AbortSignal, callback: (next: unknown) => void): void => {
        this.#subscribe(signal, callback);
      },
    });

    // Печать редактирует **актуальный** снапшот, а не тот, что был на
    // создании вида: `onChange` продолжает получать объект, чтение полей
    // которого даёт настоящие новые значения.
    defineDisplayHooks(
      view,
      secretFieldsOf(this.#declaration.fields),
      () => this.#snapshot,
    );

    return Object.freeze(view);
  }

  /**
   * Подписка поверх `Topic` + `AbortSignal`: взведённый сигнал завершает
   * итерацию, `Topic` снимает подписку и освобождает её буфер.
   */
  #subscribe(signal: AbortSignal, callback: (next: unknown) => void): void {
    const subscription = this.#topic.subscribe(signal);

    void (async () => {
      try {
        for await (const next of subscription) {
          callback(next);
        }
      } catch (error) {
        this.#reader.warn(
          `onChange subscriber of config section '${this.#declaration.prefix}' threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
  }
}

/** Проекция → живой хэндл; `WeakMap`, чтобы не держать секции живыми */
const handles = new WeakMap<object, ReloadableSection>();

/**
 * Создаёт проекцию секции: обычная — замороженный снимок, reloadable —
 * живой хэндл, поставленный читалке на перепроекцию.
 */
export const projectSection = (
  declaration: SectionDeclaration,
  reader: ConfigReader,
): unknown => {
  // Раньше чтения значений: конфликт общего ключа обязан обнаруживаться до
  // того, как провалится валидация, — иначе он объяснялся бы через ошибку,
  // которая к нему отношения не имеет.
  reader.claimKeys(declaration);

  if (!declaration.reloadable) {
    const values = readValues(declaration, reader);

    defineDisplayHooks(
      values,
      secretFieldsOf(declaration.fields),
      () => values,
    );

    return Object.freeze(values);
  }

  const section = new ReloadableSection(declaration, reader);
  reader.registerReloadable(section);
  handles.set(section.view as object, section);

  return section.view;
};

/**
 * Живой хэндл reloadable-секции по её проекции.
 *
 * Только для тестов пакета: даёт добраться до счётчика подписок, не
 * открывая внутренности в публичном API.
 *
 * @internal
 */
export const reloadableOf = (view: unknown): ReloadableSection | undefined =>
  handles.get(view as object);
