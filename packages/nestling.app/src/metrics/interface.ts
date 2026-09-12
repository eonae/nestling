/**
 * Интерфейс метрик ядра.
 *
 * Ядро и приложение пишут через один интерфейс: два метода записи и
 * атрибуты записью. Реализацию задаёт опция `makeApp({ metrics })`; ядро
 * от библиотек телеметрии не зависит и о формате экспорта не знает.
 */

/**
 * Атрибуты записи: только скаляры.
 *
 * Значения берутся из деклараций, а не из запроса: количество рядов у
 * экспортёра конечно и от трафика не растёт.
 */
export type MetricAttributes = Record<string, string | number | boolean>;

/**
 * Метрики: счётчик и гистограмма.
 *
 * Методы пишут значение, а не отдают объект-инструмент: инструмент
 * пришлось бы создавать, кэшировать и закрывать, а пустая реализация
 * перестала бы быть пустой функцией. Адаптер, которому инструменты нужны,
 * создаёт их у себя по имени.
 *
 * Оба метода синхронны и возвращают `void`: запись метрики не имеет права
 * задерживать запрос.
 *
 * @example
 * ```typescript
 * @Component([Metrics$.auto])
 * export class OrdersService {
 *   constructor(private readonly metrics: Metrics) {}
 *
 *   create() {
 *     this.metrics.counter('orders.created');
 *   }
 * }
 * ```
 */
export interface Metrics {
  /**
   * Увеличивает счётчик.
   *
   * @param name - Имя метрики
   * @param value - Прибавка; без неё — единица
   * @param attributes - Атрибуты записи
   */
  counter(name: string, value?: number, attributes?: MetricAttributes): void;

  /**
   * Добавляет наблюдение в гистограмму.
   *
   * @param name - Имя метрики
   * @param value - Наблюдённое значение
   * @param attributes - Атрибуты записи
   */
  histogram(name: string, value: number, attributes?: MetricAttributes): void;
}
