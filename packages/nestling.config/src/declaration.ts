/**
 * Форма объявления секции: рекорд полей со Standard-Schema-листьями.
 *
 * Перечислимость полей живёт на уровне JS-объекта — интроспекция вендорских
 * схем не нужна ни для деривации ключей, ни для реестра, ни для привязки.
 */

import type { ConfigKeys } from './keys.js';

import type { Schema, StandardSchemaV1 } from '@common/misc';

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

/** Лист рекорда: схема или обёртка `from()` */
export type ConfigField = Schema | FromField;

/** Рекорд полей секции */
export type ConfigRecord = Record<string, ConfigField>;

/** Выход схемы поля; обёртка `from()` прозрачна для вывода */
type FieldOutput<F> =
  F extends FromField<infer S>
    ? StandardSchemaV1.InferOutput<S>
    : F extends StandardSchemaV1
      ? StandardSchemaV1.InferOutput<F>
      : never;

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
 * Не-инстанцируемый класс: `name` перекрыт id члена семейства
 * (`'ConfigSection:orders'`), на статике лежит `.keys`. Класс-как-токен —
 * обычная DI-идиома: контейнер обращается с ним как с любым другим токеном.
 */
export interface ConfigSectionToken<Values, Prefix extends string = string> {
  /** Инстанцировать секцию нельзя: конструктор бросает именующую ошибку */
  new (...args: any[]): Values;
  /** Id члена семейства `ConfigSection` — он же строковый токен */
  readonly name: string;
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
   * Секция материализована графом, то есть кто-то её инжектнул.
   *
   * Объявленная, но не потреблённая секция не валидируется и в графе
   * отсутствует — принятая цена keys-capability.
   */
  consumed: boolean;
}
