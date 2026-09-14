/**
 * Объектный источник для собственных тестов пакета.
 *
 * Публичный аналог живёт в `@nestlingjs/testing` (`vars()`) — ядро тестов
 * `@nestlingjs/testing` не импортирует, поэтому фикстура здесь своя.
 */

import type { ConfigSource } from '../source.js';

/** Объектный источник с наблюдением — для тестов пакета */
export interface ObjectSource extends ConfigSource {
  /** Задаёт значение и уведомляет наблюдателей */
  set(key: string, value: unknown): void;
  /** Задаёт несколько значений разом и уведомляет наблюдателей один раз */
  assign(values: Readonly<Record<string, unknown>>): void;
}

/** Источник поверх обычного объекта: ни файлов, ни сети */
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
