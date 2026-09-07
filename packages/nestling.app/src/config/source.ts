/**
 * Источник конфигурации — объект, а не провайдер.
 *
 * Источники не видны пользовательскому коду как DI-токены: их читает одна
 * приватная читалка (kernel), не экспортируемая из пакета.
 */

import type { ConfigTarget } from './keys.js';

/**
 * Источник значений ключей.
 *
 * Свои координаты (путь к файлу, адрес Vault) источник берёт из
 * первичного `process.env` в `init()` — это его единственный контакт
 * с `process.env`. Бизнес-ключи он отдаёт только через `get()`.
 */
export interface ConfigSource {
  /**
   * Значение ключа или `undefined`, если источник его не знает.
   *
   * `undefined` — не отказ, а «пропускаю ход»: читалка идёт к следующей
   * привязке и в конце к `process.env`.
   */
  get(key: string): unknown;

  /** Человекочитаемое имя для предупреждений и перечня опрошенных источников */
  readonly name?: string;

  /** Разовая инициализация: читается файл, поднимается соединение */
  init?(): void | Promise<void>;

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

/**
 * Привязка источника к области ключей.
 *
 * Порядок элементов списка `config:` задаёт приоритет.
 */
export type ConfigBinding = readonly [
  source: ConfigSource,
  target: ConfigTarget | readonly ConfigTarget[],
];

/**
 * Форма поля `config:` у проверки состава и тестового корня.
 *
 * Три формы вместо одной: голый источник (сокращённая запись для
 * `[[source, '*']]`), одна привязка и список привязок. В боевом
 * `makeApp({ config })` сокращённой записи нет: там привязка — акт с
 * приоритетами, и умолчание «весь источник» неуместно.
 */
export type ConfigInput =
  | ConfigSource
  | ConfigBinding
  | readonly ConfigBinding[];

/** Значение похоже на привязку `[источник, таргет]`? */
const isBinding = (value: unknown): value is ConfigBinding =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof (value[0] as ConfigSource | undefined)?.get === 'function';

/**
 * Приводит три формы `config:` к плоскому списку привязок.
 *
 * @param config - Источник, привязка или список привязок
 * @returns Плоский список привязок; пустой, если `config` не задан
 */
export const toBindings = (config?: ConfigInput): ConfigBinding[] => {
  if (!config) {
    return [];
  }

  if (isBinding(config)) {
    return [config];
  }

  if (Array.isArray(config)) {
    return [...(config as readonly ConfigBinding[])];
  }

  // Голый источник: «весь источник» — единственное осмысленное умолчание
  return [[config as ConfigSource, '*']];
};

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
 * которого под приставкой нет, читается неявным `process.env` без неё,
 * поэтому общий ключ остаётся общим.
 *
 * `init()`, `watch()` и `close()` у источника отсутствуют: читать перед
 * стартом нечего, следить не за чем, освобождать нечего. `process.env`
 * берётся живой ссылкой — тем же способом, что и в читалке.
 *
 * @param options - Приставка к имени ключа
 *
 * @example
 * ```typescript
 * await makeApp({
 *   config: [[env({ prefix: 'SERVICE_1_' }), '*']],
 *   // …
 * }).assemble().run();
 * ```
 */
export const env = (options: EnvSourceOptions = {}): ConfigSource => {
  const prefix = options.prefix ?? '';
  const values = process.env;

  return {
    name: prefix ? `env(${prefix}*)` : 'env',
    get: (key) => values[`${prefix}${key}`],
  };
};

/** Объектный источник с наблюдением — для тестов и in-proc сценариев */
export interface ObjectSource extends ConfigSource {
  /** Задаёт значение и уведомляет наблюдателей */
  set(key: string, value: unknown): void;
  /** Задаёт несколько значений разом и уведомляет наблюдателей один раз */
  assign(values: Readonly<Record<string, unknown>>): void;
}

/**
 * Источник поверх обычного объекта: ни файлов, ни сети.
 *
 * Нужен тестам пакета и как минимальная реализация `ConfigSource` для
 * читателя доков; готовые источники (`file()`, `vault()`) живут пакетами
 * поверх интерфейса, а не в ядре.
 *
 * @example
 * ```typescript
 * const src = objectSource({ ORDERS_MAX_ITEMS: '10' });
 * src.set('ORDERS_MAX_ITEMS', '20'); // reloadable-секция перепроецируется
 * ```
 */
export const objectSource = (
  values: Readonly<Record<string, unknown>> = {},
  name = 'objectSource',
): ObjectSource => {
  const store = new Map(Object.entries(values));
  const watchers: (() => void)[] = [];

  const notify = (): void => {
    for (const watcher of watchers) {
      watcher();
    }
  };

  return {
    name,
    get: (key) => store.get(key),
    watch: (watcher) => {
      watchers.push(watcher);
    },
    set: (key, value) => {
      store.set(key, value);
      notify();
    },
    assign: (next) => {
      for (const [key, value] of Object.entries(next)) {
        store.set(key, value);
      }
      notify();
    },
  };
};
