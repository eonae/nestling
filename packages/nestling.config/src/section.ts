/**
 * `makeConfig` — объявление секции конфигурации.
 *
 * Объявление есть **значение**: ни декоратора, ни регистрации в
 * `providers`/`imports` модуля, ни ключа `configs:` у модуля не требуется.
 * Секция материализуется механикой token families ровно тогда, когда
 * кто-то её инжектит.
 */

import type {
  ConfigRecord,
  ConfigSectionToken,
  ConfigValues,
  ReloadableConfig,
  SectionDeclaration,
  SectionField,
} from './declaration.js';
import { FromField, SecretField } from './declaration.js';
import { ConfigSection } from './families.js';
import { ConfigKeys, deriveKey } from './keys.js';
import { registerSection } from './registry.js';

import type { Schema } from '@common/misc';
import { assertStandardSchema } from '@common/misc';

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
 * Строит декларацию и её токен.
 *
 * Токен — класс, у которого `name` перекрыт id члена семейства: строковый
 * токен контейнера (`stringifyToken`) совпадает с `ConfigSection(prefix)`,
 * поэтому инжект токена и материализация члена — одно и то же ребро графа.
 */
const declare = <R extends ConfigRecord, P extends string, Values>(
  prefix: P,
  record: R,
  reloadable: boolean,
): ConfigSectionToken<Values, P> => {
  const fields = Object.entries(record).map(([name, leaf]) =>
    toField(prefix, name, leaf),
  );

  if (reloadable && fields.some((f) => f.name === RELOADABLE_RESERVED)) {
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
    keys,
    consumed: false,
  };

  registerSection(declaration);

  // Тот же строковый id, что у члена семейства: вызов регистрирует член в
  // реестре семейства, без чего билдер не узнал бы токен как материализуемый.
  const id = ConfigSection(prefix);

  // Класс здесь — форма токена, а не носитель поведения: `InjectionToken`
  // это `TokenString | Constructor`, а строковый токен не может нести `.keys`.
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class Section {
    constructor() {
      throw new Error(
        `Config section '${prefix}' is not instantiable: it is a token, not a class. Inject it (@Injectable([${prefix}Config])) — the framework materializes the section itself. Registering it in 'providers:' is the same mistake.`,
      );
    }
  }

  Object.defineProperties(Section, {
    name: { value: id },
    keys: { value: keys, enumerable: true },
  });

  return Section as unknown as ConfigSectionToken<Values, P>;
};

/**
 * Объявляет секцию конфигурации.
 *
 * @param prefix - Префикс имён ключей (`'orders'` → `ORDERS_*`)
 * @param record - Рекорд полей; лист — любая Standard Schema v1 или `from()`
 * @returns Токен секции; наружу из пакета отдают только `.keys`
 *
 * @example
 * ```typescript
 * const OrdersConfig = makeConfig('orders', {
 *   maxItems: z.coerce.number().default(100),
 *   databaseUrl: from('DATABASE_URL', z.url()),
 * });
 * export const ordersKeys = OrdersConfig.keys;
 *
 * @Injectable([OrdersConfig])
 * class OrdersService {
 *   constructor(private cfg: Config<typeof OrdersConfig>) {}
 * }
 * ```
 */
export const makeConfig = <R extends ConfigRecord, P extends string>(
  prefix: P,
  record: R,
): ConfigSectionToken<ConfigValues<R>, P> =>
  declare<R, P, ConfigValues<R>>(prefix, record, false);

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
makeConfig.reloadable = <R extends ConfigRecord, P extends string>(
  prefix: P,
  record: R,
): ConfigSectionToken<ConfigValues<R> & ReloadableConfig<R>, P> =>
  declare<R, P, ConfigValues<R> & ReloadableConfig<R>>(prefix, record, true);
