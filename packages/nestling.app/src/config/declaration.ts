/**
 * Форма объявления секции: рекорд полей со Standard-Schema-листьями.
 *
 * Перечислимость полей живёт на уровне JS-объекта — интроспекция вендорских
 * схем не нужна ни для деривации ключей, ни для реестра, ни для привязки.
 */

import type { ConfigKeys } from './keys.js';

import type { Schema, StandardSchemaV1 } from '@common/misc';
import type { Token } from '@nestling/container/tokens';

/**
 * Обёртка листа, задающая **точное** имя ключа: префикс секции не
 * применяется. Так объявляются ключи, разделяемые несколькими секциями.
 *
 * Класс, а не литерал с полем-дискриминантом: `instanceof` не спутать со
 * схемой вендора, у которой случайно оказалось поле `kind`.
 */
export class FromField<S extends Schema = Schema> {
  constructor(
    readonly key: string,
    readonly schema: S,
  ) {
    Object.freeze(this);
  }
}

/**
 * Задаёт точное имя ключа для поля секции, отменяя префикс целиком.
 *
 * @param key - Имя ключа как оно есть в источнике (`'DATABASE_URL'`)
 * @param schema - Любая схема Standard Schema v1
 *
 * @example
 * ```typescript
 * const OrdersConfig = makeConfig('orders', {
 *   maxItems: z.coerce.number().default(100),  // ORDERS_MAX_ITEMS
 *   databaseUrl: from('DATABASE_URL', z.url()), // DATABASE_URL
 * });
 * ```
 */
export const from = <S extends Schema>(key: string, schema: S): FromField<S> =>
  new FromField(key, schema);

/**
 * Обёртка листа, помечающая поле **секретным**: значение не появляется ни в
 * одном тексте, произведённом фреймворком.
 *
 * Тот же класс-а-не-литерал, что у {@link FromField}, и по той же причине.
 */
export class SecretField<L extends Schema | FromField = Schema | FromField> {
  constructor(readonly leaf: L) {
    Object.freeze(this);
  }
}

/**
 * Помечает поле секции секретным.
 *
 * Порядок вложения единственный: `secret()` снаружи, `from()` внутри —
 * секретность есть свойство **поля**, а `from()` лишь называет его **ключ**.
 * Для потребителя тип значения не меняется: `secret(z.string())` — это
 * `string`, брендированного `Secret<T>` в v1 нет.
 *
 * @param leaf - Схема Standard Schema v1 или результат `from(key, schema)`
 *
 * @example
 * ```typescript
 * const OrdersConfig = makeConfig('orders', {
 *   apiToken: secret(z.string()),                    // ORDERS_API_TOKEN
 *   databaseUrl: secret(from('DATABASE_URL', z.url())), // DATABASE_URL
 * });
 * ```
 */
export const secret = <L extends Schema | FromField>(leaf: L): SecretField<L> =>
  new SecretField(leaf);

/** Лист рекорда: схема, обёртка `from()` или `secret()` поверх любой из них */
export type ConfigField = Schema | FromField | SecretField;

/** Рекорд полей секции */
export type ConfigRecord = Record<string, ConfigField>;

/** Выход схемы листа; обёртка `from()` прозрачна для вывода */
type LeafOutput<F> =
  F extends FromField<infer S>
    ? StandardSchemaV1.InferOutput<S>
    : F extends StandardSchemaV1
      ? StandardSchemaV1.InferOutput<F>
      : never;

/** Выход схемы поля; обе обёртки прозрачны для вывода */
type FieldOutput<F> =
  F extends SecretField<infer L> ? LeafOutput<L> : LeafOutput<F>;

/**
 * Вычисляемое поле секции: список зависимостей и функция от их значений.
 *
 * Ключа у поля нет: значение берётся из других полей той же секции, а не из
 * источника. Тот же класс-а-не-литерал, что у {@link FromField}.
 */
export class DerivedField<
  D extends readonly string[] = readonly string[],
  T = unknown,
> {
  constructor(
    /** Имена полей рекорда, значения которых получает {@link compute} */
    readonly deps: D,
    /** Функция поля; аргументы идут в порядке {@link deps} */
    readonly compute: (...values: unknown[]) => T,
  ) {
    Object.freeze(this);
  }
}

/** Рекорд вычисляемых полей — то, что возвращает третий аргумент `makeConfig` */
export type DerivedRecord = Record<string, DerivedField>;

/** Пустой рекорд вычисляемых полей: секция объявлена без третьего аргумента */
type NoDerived = Record<never, never>;

/**
 * Конструктор вычисляемого поля, типизированный рекордом секции.
 *
 * `deps` ограничен именами полей рекорда, а типы аргументов `fn` выведены из
 * схем этих полей. Поэтому опечатка в имени и ложная аннотация аргумента —
 * ошибки компиляции, а не рантайм-проверки в момент объявления. Зависеть от
 * другого вычисляемого поля нечем: в рекорде их нет.
 */
export type DerivedConstructor<R extends ConfigRecord> = <
  const D extends readonly (keyof R & string)[],
  T,
>(
  deps: D,
  fn: (...values: { -readonly [I in keyof D]: FieldOutput<R[D[I]]> }) => T,
) => DerivedField<D, T>;

/** Третий аргумент `makeConfig`: конструктор на входе, рекорд полей на выходе */
export type DeriveFn<R extends ConfigRecord, D extends DerivedRecord> = (
  derived: DerivedConstructor<R>,
) => D;

/** Выход вычисляемого поля — возврат его функции */
type DerivedOutput<F> =
  F extends DerivedField<readonly string[], infer T> ? T : never;

/**
 * Проекция секции: объект, где тип каждого поля — выход его схемы.
 *
 * Вычисляемые поля стоят наравне с обычными: их тип — возврат функции поля.
 * Порядок членов тот же, что у объявления: сначала поля рекорда, затем
 * вычисляемые.
 *
 * Read-only: значения секции неизменяемы, объект заморожен на `build()`.
 */
export type ConfigValues<
  R extends ConfigRecord,
  D extends DerivedRecord = NoDerived,
> = {
  readonly [K in keyof R]: FieldOutput<R[K]>;
} & {
  readonly [K in keyof D]: DerivedOutput<D[K]>;
};

/**
 * Дополнение проекции reloadable-секции.
 *
 * У обычной секции этих членов нет — ни в типах, ни в рантайме.
 */
export interface ReloadableConfig<
  R extends ConfigRecord,
  D extends DerivedRecord = NoDerived,
> {
  /**
   * Подписка на успешное обновление секции; снимается по взведению `signal`.
   *
   * @param signal - Сигнал отписки (обычно — сигнал `@OnStart`)
   * @param callback - Вызывается с новым значением секции
   */
  onChange(
    signal: AbortSignal,
    callback: (next: ConfigValues<R, D>) => void,
  ): void;
}

/**
 * DI-токен секции — право инжекта.
 *
 * Это сам член семейства `ConfigSection`, на который дописан `.keys`:
 * инжект секции и упоминание члена — одно и то же ребро графа, потому что
 * это один и тот же DI-токен.
 */
export interface ConfigSectionToken<Values, Prefix extends string = string>
  extends Token<Values> {
  /** Хэндл ключей секции — право привязки, безопасное для экспорта */
  readonly keys: ConfigKeys<Prefix>;
}

/** Поле секции в разобранном виде */
export interface SectionField {
  /** Имя поля в рекорде */
  readonly name: string;
  /** Имя ключа: выведенное из префикса или заданное `from()` */
  readonly key: string;
  /** Имя задано `from()`, а не выведено */
  readonly exact: boolean;
  /** Схема поля */
  readonly schema: Schema;
  /**
   * Поле объявлено `secret()` **этой** секцией.
   *
   * Эффективная секретность ключа шире: она считается объединением по всем
   * объявленным читателям — см. `isSecretKey()` в реестре.
   */
  readonly secret: boolean;
}

/** Вычисляемое поле секции в разобранном виде */
export interface SectionDerived {
  /** Имя поля в проекции */
  readonly name: string;
  /** Имена полей-зависимостей в порядке объявления */
  readonly deps: readonly string[];
  /**
   * Ключи полей-зависимостей в том же порядке.
   *
   * Разрешаются один раз, при объявлении: секретность поля считается по
   * ключам зависимостей, а перебирать рекорд на каждый вопрос незачем.
   */
  readonly depKeys: readonly string[];
  /** Функция поля; аргументы идут в порядке {@link deps} */
  readonly compute: (...values: unknown[]) => unknown;
}

/** Запись реестра: всё, что известно о секции без обращения к источникам */
export interface SectionDeclaration {
  /** Префикс секции — ключ реестра */
  readonly prefix: string;
  /** Объявлена ли секция `makeConfig.reloadable` */
  readonly reloadable: boolean;
  /** Поля в порядке объявления */
  readonly fields: readonly SectionField[];
  /** Вычисляемые поля в порядке объявления */
  readonly derived: readonly SectionDerived[];
  /** Хэндл ключей — то же значение, что лежит на `.keys` DI-токена */
  readonly keys: ConfigKeys;
  /**
   * Секция создана графом, то есть кто-то её инжектнул.
   *
   * Объявленная, но не потреблённая секция не валидируется и в графе
   * отсутствует — принятая цена keys-capability.
   */
  consumed: boolean;
}
