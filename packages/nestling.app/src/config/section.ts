/**
 * `makeConfig` — объявление секции конфигурации.
 *
 * Объявление есть **значение**: ни декоратора, ни регистрации в
 * `providers`/`imports` модуля, ни ключа `configs:` у модуля не требуется.
 * Секция создаётся механикой token families ровно тогда, когда
 * кто-то её инжектит.
 */

import type {
  ConfigRecord,
  ConfigSectionToken,
  ConfigValues,
  DerivedConstructor,
  DerivedRecord,
  DeriveFn,
  ReloadableConfig,
  SectionDeclaration,
  SectionDerived,
  SectionField,
} from './declaration.js';
import { DerivedField, FromField, SecretField } from './declaration.js';
import { ConfigSection } from './families.js';
import { ConfigKeys, deriveKey, derivePrefix } from './keys.js';
import { registerSection } from './registry.js';

import type { Schema } from '@nestlingjs/common.misc';
import { assertStandardSchema } from '@nestlingjs/common.misc';

/**
 * Имя члена проекции reloadable-секции, занятое подпиской.
 *
 * Поле с таким именем сделало бы `onChange` недоступным — ловим на
 * объявлении, а не на первом обращении в рантайме.
 */
const RELOADABLE_RESERVED = 'onChange';

/**
 * Разбирает лист рекорда в поле секции, называя секцию и поле в ошибке.
 *
 * Обёртки разворачиваются в каноническом порядке: `secret()` снаружи,
 * `from()` внутри. Обратный порядок уже отвергается типами (`from()` требует
 * схему, а `SecretField` её не реализует), но JS-потребитель и `as any` мимо
 * типов проходят — им ветка ниже называет починку, иначе они получили бы
 * невнятное «is not a Standard Schema v1 value».
 */
const toField = (prefix: string, name: string, leaf: unknown): SectionField => {
  const secret = leaf instanceof SecretField;
  const named: unknown = secret ? leaf.leaf : leaf;

  const exact = named instanceof FromField;
  const schema: unknown = exact ? (named as FromField).schema : named;

  if (schema instanceof SecretField) {
    throw new TypeError(
      `Field '${name}' of config section '${prefix}' wraps from() around secret(). ` +
        `The order is fixed: secret() outside, from() inside — secret(from('KEY', schema)). ` +
        `Secrecy is a property of the field, from() only names its key.`,
    );
  }

  try {
    assertStandardSchema(schema);
  } catch (error) {
    throw new Error(
      `Field '${name}' of config section '${prefix}' is not a Standard Schema v1 value`,
      { cause: error },
    );
  }

  return {
    name,
    key: exact ? (named as FromField).key : deriveKey(prefix, name),
    exact,
    schema: schema as Schema,
    secret,
  };
};

/**
 * Реализация конструктора вычисляемого поля.
 *
 * Одна на все секции: типы задаёт {@link DerivedConstructor}, а в рантайме
 * конструктор только заворачивает аргументы в {@link DerivedField}.
 */
const derived = (
  deps: readonly string[],
  fn: (...values: unknown[]) => unknown,
): DerivedField => new DerivedField(deps, fn);

/**
 * Разбирает рекорд вычисляемых полей, разрешая имена зависимостей в ключи.
 *
 * Имя, занятое полем рекорда, — ошибка объявления: проекция потеряла бы одно
 * из двух значений, и заметить это можно было бы только в рантайме.
 */
const toDerived = (
  prefix: string,
  fields: readonly SectionField[],
  record: DerivedRecord,
): SectionDerived[] =>
  Object.entries(record).map(([name, field]) => {
    if (fields.some((declared) => declared.name === name)) {
      throw new Error(
        `Config section '${prefix}' declares a derived field named '${name}', but a field with that name is already declared in the record. Rename one of them.`,
      );
    }

    return {
      name,
      deps: field.deps,
      depKeys: field.deps.map((dep) => {
        const target = fields.find((declared) => declared.name === dep);

        if (!target) {
          throw new Error(
            `Derived field '${name}' of config section '${prefix}' depends on '${dep}', which is not a field of the section record.`,
          );
        }

        return target.key;
      }),
      compute: field.compute,
    };
  });

/**
 * Строит декларацию и её DI-токен.
 *
 * DI-токен — сам член семейства `ConfigSection`, на который дописан `.keys`.
 * Инжект DI-токена и упоминание члена — одно и то же ребро графа, потому что
 * это одно и то же значение.
 */
const declare = <
  R extends ConfigRecord,
  D extends DerivedRecord,
  P extends string,
  Values,
>(
  prefix: P,
  record: R,
  derive: DeriveFn<R, D> | undefined,
  reloadable: boolean,
): ConfigSectionToken<Values, P> => {
  const fields = Object.entries(record).map(([name, leaf]) =>
    toField(prefix, name, leaf),
  );

  const computed = derive
    ? toDerived(prefix, fields, derive(derived as DerivedConstructor<R>))
    : [];

  if (
    reloadable &&
    [...fields, ...computed].some((f) => f.name === RELOADABLE_RESERVED)
  ) {
    throw new Error(
      `Config section '${prefix}' declares a field named '${RELOADABLE_RESERVED}', which is the subscription member of a reloadable section. Rename the field.`,
    );
  }

  const keys = new ConfigKeys(
    prefix,
    fields.map((field) => field.key),
  );

  const declaration: SectionDeclaration = {
    prefix,
    reloadable,
    fields,
    derived: computed,
    keys,
    consumed: false,
  };

  registerSection(declaration);

  // DI-токен секции и член семейства — одно значение: рецепт семейства
  // создаёт узел ровно для того DI-токена, который стоит в `deps`
  const token = ConfigSection(prefix);

  Object.defineProperty(token, 'keys', { value: keys, enumerable: true });

  return token as unknown as ConfigSectionToken<Values, P>;
};

/**
 * Объявляет секцию конфигурации.
 *
 * @param prefix - Префикс имён ключей (`'orders'` → `ORDERS_*`)
 * @param record - Рекорд полей; лист — любая Standard Schema v1 или `from()`
 * @param derive - Рекорд вычисляемых полей, собранный конструктором `derived`
 * @returns DI-токен секции; наружу из пакета отдают только `.keys`
 *
 * @example
 * ```typescript
 * const OrdersConfig = makeConfig('orders', {
 *   maxItems: z.coerce.number().default(100),
 *   databaseUrl: from('DATABASE_URL', z.url()),
 * });
 * export const ordersKeys = OrdersConfig.keys;
 *
 * @Component([OrdersConfig])
 * class OrdersService {
 *   constructor(private cfg: Config<typeof OrdersConfig>) {}
 * }
 * ```
 *
 * @example Вычисляемое поле
 * ```typescript
 * const PgConfig = makeConfig('pg', {
 *   host: z.string().default('localhost'),
 *   port: z.coerce.number().int().default(5432),
 *   password: secret(z.string()),
 * }, (derived) => ({
 *   url: derived(['host', 'port', 'password'],
 *     (host, port, password) => `postgresql://app:${password}@${host}:${port}/app`),
 * }));
 * ```
 */
export const makeConfig = <
  R extends ConfigRecord,
  P extends string,
  D extends DerivedRecord = Record<never, never>,
>(
  prefix: P,
  record: R,
  derive?: DeriveFn<R, D>,
): ConfigSectionToken<ConfigValues<R, D>, P> =>
  declare<R, D, P, ConfigValues<R, D>>(prefix, record, derive, false);

/**
 * Объявляет секцию, значения полей которой могут меняться в течение жизни
 * процесса.
 *
 * Проекция — read-latest: чтение поля отдаёт последнее валидное значение,
 * подписка для этого не нужна. Инстанс стабилен, `onChange(signal, cb)`
 * даёт реакцию с отпиской по сигналу.
 *
 * Reloadable — opt-in ровно потому, что вступление изменения в силу
 * остаётся ответственностью потребителя: значение, скопированное в
 * конструкторе, не обновится.
 */
makeConfig.reloadable = <
  R extends ConfigRecord,
  P extends string,
  D extends DerivedRecord = Record<never, never>,
>(
  prefix: P,
  record: R,
  derive?: DeriveFn<R, D>,
): ConfigSectionToken<ConfigValues<R, D> & ReloadableConfig<R, D>, P> =>
  declare<R, D, P, ConfigValues<R, D> & ReloadableConfig<R, D>>(
    prefix,
    record,
    derive,
    true,
  );

/**
 * Объявляет секцию-семейство: одна секция на каждый экземпляр пакета.
 *
 * Нужна там, где экземпляров несколько, а значения у них разные:
 * HTTP-сервер по умолчанию и админский слушают разные порты, поэтому
 * читать один `HTTP_PORT` они не могут. Префикс строится из имени
 * экземпляра: `'default'` даёт ключи пакета как есть (`HTTP_PORT`),
 * `'admin'` — с добавкой (`HTTP_ADMIN_PORT`).
 *
 * Секция одного имени объявляется один раз: повторный вызов с тем же
 * именем отдаёт тот же DI-токен, то есть тот же узел графа. Дескриптор
 * `.keys` у каждого экземпляра свой, поэтому привязка источника адресует
 * ключи одного экземпляра, а не всего пакета.
 *
 * @param prefix - Префикс пакета (`'http'`)
 * @param record - Рекорд полей; тот же, что у `makeConfig`
 * @param derive - Рекорд вычисляемых полей; тот же, что у `makeConfig`
 * @returns Функция «имя экземпляра → DI-токен его секции»
 *
 * @example
 * ```typescript
 * const HttpServerConfig = makeConfig.family('http', {
 *   port: z.coerce.number().int().default(3000),
 *   host: z.string().default('0.0.0.0'),
 * });
 *
 * HttpServerConfig('default').keys; // HTTP_PORT, HTTP_HOST
 * HttpServerConfig('admin').keys;   // HTTP_ADMIN_PORT, HTTP_ADMIN_HOST
 * ```
 */
makeConfig.family = <
  R extends ConfigRecord,
  P extends string,
  D extends DerivedRecord = Record<never, never>,
>(
  prefix: P,
  record: R,
  derive?: DeriveFn<R, D>,
): ((instance: string) => ConfigSectionToken<ConfigValues<R, D>, string>) => {
  const declared = new Map<
    string,
    ConfigSectionToken<ConfigValues<R, D>, string>
  >();

  return (instance: string) => {
    const existing = declared.get(instance);

    if (existing) {
      return existing;
    }

    const token = declare<R, D, string, ConfigValues<R, D>>(
      derivePrefix(prefix, instance),
      record,
      derive,
      false,
    );

    declared.set(instance, token);

    return token;
  };
};
