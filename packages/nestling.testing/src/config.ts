/**
 * Конфиг тестового прогона: объектом, а не через `process.env`.
 *
 * `vars()` — собственная реализация `ConfigSource`, а не обёртка над ядром:
 * ядро экспортирует источники (`env`, `dotenv`), но не объектный, — тестовый
 * шов герметичен по построению, и его источник живёт здесь же.
 */

import type { ConfigSource } from '@nestlingjs/app';

/** Именованный объектный источник конфигурации с наблюдением */
export interface ObjectSource extends ConfigSource {
  /** Задаёт значение и уведомляет наблюдателей */
  set(key: string, value: unknown): void;
  /** Задаёт несколько значений разом и уведомляет наблюдателей один раз */
  assign(values: Readonly<Record<string, unknown>>): void;
}

/**
 * Именованный объектный источник конфигурации.
 *
 * Называет **шов**: конфиг теста задаётся объектом, `process.env` не
 * трогается, поэтому тесты изолированы и параллелимы без дополнительного
 * кода. `set`/`assign` уведомляют reloadable-секции, привязанные к этому
 * источнику через `bind(vars({ … }))`.
 *
 * @param record - Значения ключей; ключи те же, что читал бы источник env
 * @returns Источник с `get`/`watch`/`set`/`assign`
 *
 * @example
 * ```typescript
 * const src = vars({ USERS_PAGE_SIZE: '10' });
 * await using app = await buildTest(appDecl, { config: [bind(src)] });
 *
 * src.set('USERS_PAGE_SIZE', '20'); // reloadable-секция перепроецируется
 * ```
 */
export const vars = (
  record: Readonly<Record<string, unknown>> = {},
): ObjectSource => {
  const store = new Map(Object.entries(record));
  const watchers: (() => void)[] = [];

  const notify = (): void => {
    for (const watcher of watchers) {
      watcher();
    }
  };

  return {
    name: 'vars',
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
