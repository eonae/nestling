/**
 * Источник конфигурации — объект, а не провайдер.
 *
 * Источники не видны пользовательскому коду как токены: их читает одна
 * приватная читалка (kernel), не экспортируемая из пакета.
 */

import type { ConfigTarget } from './keys.js';

/**
 * Источник значений ключей.
 *
 * Свои координаты (путь к файлу, адрес волта) источник берёт из
 * примордиального `process.env` в `init()` — это его единственный контакт
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
