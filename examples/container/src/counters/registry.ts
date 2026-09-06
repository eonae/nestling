import { makeTokenFamily } from '@nestling/container';

/** Счётчик с именем: считает события одного вида */
export interface Counter {
  readonly name: string;
  readonly value: number;
  increment(): number;
}

/**
 * Семейство токенов счётчиков: `Counter$('users')` — токен `Counter:users`.
 *
 * Рецепт на всё семейство поставляет плагин `appCounters`; контейнер
 * создаёт только те члены, которые кто-то запросил в `deps`.
 */
export const Counter$ = makeTokenFamily<Counter, [name: string]>('Counter');
