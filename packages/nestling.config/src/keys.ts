/**
 * Имена ключей и таргеты привязки.
 *
 * Секция провенанс-слепа: она называет **ключ**, а не источник. Всё, что
 * знает этот файл, — как из префикса и имени поля получить имя ключа и как
 * проверить, покрывает ли таргет привязки данный ключ.
 */

/**
 * Хэндл набора ключей секции — вторая из двух capability секции
 * (первая — сам токен, право инжекта).
 *
 * Это **право привязки** и только оно: экземпляр не является ни
 * `TokenString`, ни конструктором, поэтому в `deps` его не поставить —
 * ошибка компиляции. Отсюда безопасность экспорта: пакет отдаёт наружу
 * `Section.keys`, оставляя токен приватным, и чужой инжект нечем написать.
 *
 * Класс, а не структурный бренд: нужен `instanceof` для матчинга таргетов
 * и различимость `ConfigKeys<'orders'>` от `ConfigKeys<'users'>` по
 * параметру `prefix`.
 */
export class ConfigKeys<Prefix extends string = string> {
  /** Префикс секции, которой принадлежит набор */
  readonly prefix: Prefix;

  /** Имена ключей в порядке объявления полей, включая заданные `from()` */
  readonly names: readonly string[];

  constructor(prefix: Prefix, names: readonly string[]) {
    this.prefix = prefix;
    this.names = Object.freeze([...names]);
    Object.freeze(this);
  }

  toString(): string {
    return `ConfigKeys(${this.prefix})`;
  }
}

/**
 * Глоб — таргет того же вида, что и хэндл: строка вроде `'*_GRPC_ADDRESS'`
 * или `'*'` (весь источник).
 *
 * Форма привязки для unbound-ключей, которых ни одна секция не объявляла:
 * их объявляют семейства (`Config(key)`), и на момент сборки перечня имён
 * может не существовать.
 */
export type ConfigGlob = string;

/** Что можно указать в привязке как область источника */
export type ConfigTarget = ConfigKeys | ConfigGlob;

/** Скомпилированные глобы: матчинг зовётся на каждый ключ каждой привязки */
const globCache = new Map<string, RegExp>();

/**
 * Компилирует глоб в якорное регулярное выражение.
 *
 * Синтаксис намеренно беден: единственный метасимвол — `*` («любая
 * последовательность»), всё остальное экранируется. `'*'` покрывает всё,
 * `'*_URL'` — суффикс, `'ORDERS_*'` — префикс.
 */
const globToRegExp = (glob: string): RegExp => {
  const cached = globCache.get(glob);
  if (cached) {
    return cached;
  }

  const pattern = glob
    .split('*')
    .map((part) => part.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`))
    .join('.*');

  const compiled = new RegExp(`^${pattern}$`);
  globCache.set(glob, compiled);

  return compiled;
};

/** Покрывает ли таргет привязки данный ключ */
export const targetCovers = (target: ConfigTarget, key: string): boolean =>
  target instanceof ConfigKeys
    ? target.names.includes(key)
    : globToRegExp(target).test(key);

/** Человекочитаемое имя таргета — для предупреждений и ошибок */
export const describeTarget = (target: ConfigTarget): string =>
  target instanceof ConfigKeys ? target.toString() : `'${target}'`;

/**
 * `camelCase` → `SCREAMING_SNAKE`.
 *
 * Разделитель вставляется на границе «строчная или цифра → прописная»
 * (`maxItems` → `MAX_ITEMS`, `s3Bucket` → `S3_BUCKET`) и «прописная →
 * прописная, за которой идёт строчная» (`httpURLValue` → `HTTP_URL_VALUE`).
 * Правило детерминированное и документированное: угадать имя ключа по имени
 * поля не должно требовать чтения исходников.
 */
export const screamingSnake = (value: string): string =>
  value
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();

/** Имя ключа поля секции: `<PREFIX>_<FIELD>` */
export const deriveKey = (prefix: string, field: string): string =>
  `${screamingSnake(prefix)}_${screamingSnake(field)}`;
