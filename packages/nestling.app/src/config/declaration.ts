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
 * Проекция секции: объект, где тип каждого поля — выход его схемы.
 *
 * Read-only: значения секции неизменяемы, объект заморожен на `build()`.
 */
export type ConfigValues<R extends ConfigRecord> = {
  readonly [K in keyof R]: FieldOutput<R[K]>;
};

/**
 * Дополнение проекции reloadable-секции.
 *
 * У обычной секции этих членов нет — ни в типах, ни в рантайме.
 */
export interface ReloadableConfig<R extends ConfigRecord> {
  /**
   * Подписка на успешное обновление секции; снимается по взведению `signal`.
   *
   * @param signal - Сигнал отписки (обычно — сигнал `@OnStart`)
   * @param callback - Вызывается с новым значением секции
   */
  onChange(
    signal: AbortSignal,
    callback: (next: ConfigValues<R>) => void,
  ): void;
}

/**
 * Токен секции — право инжекта.
 *
 * Это сам член семейства `ConfigSection`, на который дописан `.keys`:
 * инжект секции и упоминание члена — одно и то же ребро графа, потому что
 * это один и тот же токен.
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

/** Запись реестра: всё, что известно о секции без обращения к источникам */
export interface SectionDeclaration {
  /** Префикс секции — ключ реестра */
  readonly prefix: string;
  /** Объявлена ли секция `makeConfig.reloadable` */
  readonly reloadable: boolean;
  /** Поля в порядке объявления */
  readonly fields: readonly SectionField[];
  /** Хэндл ключей — то же значение, что лежит на `.keys` токена */
  readonly keys: ConfigKeys;
  /**
   * Секция создана графом, то есть кто-то её инжектнул.
   *
   * Объявленная, но не потреблённая секция не валидируется и в графе
   * отсутствует — принятая цена keys-capability.
   */
  consumed: boolean;
}
