/**
 * Источник конфигурации и его привязка к области ключей.
 *
 * Источники не видны пользовательскому коду как DI-токены: их читает одна
 * приватная читалка (kernel), не экспортируемая из пакета.
 */

import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

import type { ConfigSectionToken } from './declaration.js';
import type { ConfigTarget } from './keys.js';

/**
 * Пустое значение ключа — то же, что незаданный ключ.
 *
 * `KEY=` в окружении или в файле означает «ключ не задан», и решает дальше
 * схема поля: `default` даёт умолчание, обязательное поле даёт отказ. Ядро
 * сводит пустую строку к `undefined` **до** схемы, поэтому схемам полей
 * знать об этом правиле не нужно — ни своим, ни пользовательским.
 *
 * Правило живёт здесь одно на все пути чтения: проекцию секции из графа,
 * первичное чтение фазы 0 и подсчёт недостающих ключей секции `needs`.
 * Порядок поиска значения оно не трогает — значение уже взято у первой
 * привязки, которая ключ покрывает.
 */
export const presentValue = (raw: unknown): unknown =>
  raw === '' ? undefined : raw;

/**
 * Источник значений ключей.
 *
 * Координаты источника приходят аргументом его конструктора
 * (`dotenv(path)`) или значениями секции, объявленной полем `needs`, —
 * `process.env` внутри `init()` источник не читает. Бизнес-ключи он отдаёт
 * только через `get()`.
 *
 * @template Needs - Значения секции, которые источнику нужны для подъёма;
 * `void` у источника без зависимостей
 */
export interface ConfigSource<Needs = void> {
  /**
   * Значение ключа или `undefined`, если источник его не знает.
   *
   * `undefined` — не отказ, а «пропускаю ход»: читалка идёт к следующей
   * привязке списка.
   */
  get(key: string): unknown;

  /** Человекочитаемое имя для предупреждений и перечня опрошенных источников */
  readonly name?: string;

  /**
   * DI-токен секции, значения которой нужны источнику для подъёма.
   *
   * Читалка поднимает источник после тех привязок, которые покрывают ключи
   * секции, проецирует её и отдаёт значения аргументом `init`. Источник без
   * зависимостей поле не объявляет.
   */
  readonly needs?: ConfigSectionToken<Needs>;

  /**
   * Разовая инициализация: читается файл, поднимается соединение.
   *
   * @param values - Проверенные значения секции `needs`; у источника без
   * `needs` параметра нет
   */
  init?(values: Needs): void | Promise<void>;

  /**
   * Подписка на изменение содержимого источника.
   *
   * Вызов `notify` заставляет читалку перечитать и перепроецировать
   * reloadable-секции. Источник без `watch` — обычный статический источник.
   */
  watch?(notify: () => void): void;

  /** Освобождение ресурсов; вызывается на общем shutdown контейнера */
  close?(): void | Promise<void>;
}

/** Опции {@link bind} */
export interface BindOptions {
  /**
   * Область источника: секция (`ConfigKeys`) или глоб.
   *
   * Умолчание `'*'` — источник отвечает за любой ключ любой секции, так же,
   * как раньше неявно отвечал `process.env`, будучи источником читалки с
   * низшим приоритетом.
   */
  readonly keys?: ConfigTarget;

  /**
   * Источник, чей `init()` отказал или не уложился в `timeout`, пропускается
   * вместо отказа фазы 0.
   */
  readonly optional?: boolean;

  /** Граница ввода-вывода `init()` этой привязки, мс. Умолчание — 10000 */
  readonly timeout?: number;
}

/**
 * Привязка источника к области ключей — результат {@link bind}.
 *
 * Источник хранится как `ConfigSource<unknown>`: список привязок однороден,
 * а форму значений `needs` сверил {@link bind} в месте вызова.
 */
export interface Binding {
  readonly source: ConfigSource<unknown>;
  readonly keys: ConfigTarget;
  readonly optional: boolean;
  readonly timeout: number;
}

/** Умолчание {@link BindOptions.timeout}, мс */
const DEFAULT_TIMEOUT = 10_000;

/**
 * Привязывает источник к области ключей.
 *
 * Порядок элементов списка, которым `bind()` передаётся `run()`, `check()`
 * или `assembleTest()`, задаёт приоритет: ключ разрешается первой
 * привязкой, чей `keys` его покрывает и чей источник вернул значение,
 * отличное от `undefined`.
 *
 * @param source - Источник значений
 * @param options - Область, необязательность и таймаут инициализации
 * @returns Привязка — элемент списка `config` у `run()`, `check()` и `assembleTest()`
 *
 * @example
 * ```typescript
 * await app.build().run({
 *   config: [bind(vault(), { keys: ordersKeys }), bind(env())],
 * });
 * ```
 */
export const bind = <Needs>(
  source: ConfigSource<Needs>,
  options: BindOptions = {},
): Binding => ({
  source,
  keys: options.keys ?? '*',
  optional: options.optional ?? false,
  timeout: options.timeout ?? DEFAULT_TIMEOUT,
});

/** Опции источника окружения */
export interface EnvSourceOptions {
  /** Приставка к имени ключа: `'SERVICE_1_'` даёт `SERVICE_1_HTTP_PORT` */
  readonly prefix?: string;
}

/**
 * Источник окружения с приставкой к имени ключа.
 *
 * Читает `<prefix><KEY>` и отдаёт значение под именем `KEY`. Так один `.env`
 * обслуживает несколько сервисов: секции, их поля и дескрипторы `.keys`
 * остаются относительными, а приставка живёт в источнике.
 *
 * Приоритет задаётся позицией привязки, как у любого источника. Ключ,
 * которого под приставкой нет, читается следующей привязкой списка — общий
 * ключ остаётся общим явной второй привязкой `bind(env())` без приставки.
 *
 * `init()`, `watch()` и `close()` у источника отсутствуют: читать перед
 * стартом нечего, следить не за чем, освобождать нечего. `process.env`
 * берётся живой ссылкой — тем же способом, что и в читалке.
 *
 * @param options - Приставка к имени ключа
 *
 * @example
 * ```typescript
 * await app.build().run({
 *   config: [bind(env({ prefix: 'SERVICE_1_' })), bind(env())],
 * });
 * ```
 */
export const env = (options: EnvSourceOptions = {}): ConfigSource => {
  const prefix = options.prefix ?? '';
  // eslint-disable-next-line @nestlingjs/no-process-globals -- источник и есть шов с окружением
  const values = process.env;

  return {
    name: prefix ? `env(${prefix}*)` : 'env',
    get: (key) => values[`${prefix}${key}`],
  };
};

/**
 * Источник `.env`-файла на `node:util` `parseEnv` — без внешней зависимости.
 *
 * Путь — аргумент конструктора, а не чтение `process.env` в поисках
 * координат. Файл читается один раз в `init()`; отсутствие файла отказывает
 * фазу 0 (называя источник, чьё имя несёт путь), если привязка не
 * `optional`.
 *
 * @param path - Путь к `.env`-файлу
 * @returns Источник, чей `init()` разбирает файл
 *
 * @example
 * ```typescript
 * export const defaultSources = [bind(env()), bind(dotenv('.env'), { optional: true })];
 * ```
 */
export const dotenv = (path: string): ConfigSource => {
  let values: NodeJS.Dict<string> = {};

  return {
    name: `dotenv(${path})`,
    init: async () => {
      values = parseEnv(await readFile(path, 'utf8'));
    },
    get: (key) => values[key],
  };
};

/**
 * Привязки источников по умолчанию: окружение выше файла, файл необязателен.
 *
 * `run()`, `check()` без опции `config` поднимают этот список. Приложение,
 * которому достаточно умолчания, про конфиг не пишет вовсе; приложение,
 * которому нужно больше (Vault, второй `.env`), достраивает список поверх
 * него, а не переписывает его.
 */
export const defaultSources: readonly Binding[] = [
  bind(env()),
  bind(dotenv('.env'), { optional: true }),
];
