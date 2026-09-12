/**
 * Пустая реализация метрик — умолчание корня.
 *
 * Фича, которая пишет метрику, собирается без установленного сателлита:
 * узел `RootMetrics$` есть в графе всегда, и без опции `makeApp({ metrics })`
 * под ним стоит это значение. Методы ничего не делают и ничего не создают.
 */

import type { Metrics } from './interface.js';

/* eslint-disable @typescript-eslint/no-empty-function --
 * пустота здесь и есть поведение: запись уходит в никуда, не создавая
 * ни объекта, ни замыкания */
export const noopMetrics: Metrics = {
  counter: () => {},
  histogram: () => {},
};
/* eslint-enable @typescript-eslint/no-empty-function */

/**
 * Метрики, настроенные приложением, или `undefined`, если под корнем
 * стоит умолчание.
 *
 * По этому ответу ядро решает, инструментовать ли горячий путь: без
 * настоящей реализации оно не снимает время и не вызывает методы записи.
 * Сравнение по ссылке, а не флаг в интерфейсе: флаг обязал бы каждого
 * адаптера отвечать на вопрос рантайма, а ответ всегда один.
 *
 * @internal
 */
export const configuredMetrics = (root: Metrics): Metrics | undefined =>
  root === noopMetrics ? undefined : root;
