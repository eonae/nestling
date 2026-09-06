import { AppConfig } from '../config/app.config.js';

import type { Counter } from './registry.js';
import { Counter$ } from './registry.js';

import type { Config } from '@nestling/app';
import { makePlugin } from '@nestling/app';
import { factoryProvider, familyProvider } from '@nestling/container';

/** Счётчик в памяти; полное имя складывается из префикса и имени члена */
class InMemoryCounter implements Counter {
  #value = 0;

  constructor(readonly name: string) {}

  get value(): number {
    return this.#value;
  }

  increment(): number {
    this.#value += 1;

    return this.#value;
  }
}

/**
 * Плагин счётчиков: инфраструктура, к которой обращаются DI-токеном из
 * любого модуля.
 */
export const appCounters = makePlugin({
  name: 'app-counters',
  providers: [
    // Один рецепт на всё семейство: `name` — параметр запрошенного члена.
    // Префикс читается из секции конфига, как любая зависимость
    familyProvider(Counter$, (name) =>
      factoryProvider(
        Counter$(name),
        (config: Config<typeof AppConfig>) =>
          new InMemoryCounter(`${config.metricsPrefix}.${name}`),
        [AppConfig] as const,
      ),
    ),
  ],
});
