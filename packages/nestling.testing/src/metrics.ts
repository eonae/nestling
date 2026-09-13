/**
 * Чтение метрик тестового приложения.
 *
 * Перехватывать нечего: записи лежат в store приложения, и тест читает
 * его снимок. Ряд адресуется членом группы и атрибутами, поэтому опечатка
 * в имени метрики в тесте так же невыразима, как в коде.
 */

import type {
  AnyMember,
  HistogramSeries,
  MetricAttributes,
  MetricSeries,
  MetricsSnapshot,
  MetricsStore,
} from '@nestlingjs/app';
import { findSeries, findSeriesOne } from '@nestlingjs/app';

/**
 * Метрики тестового приложения: снимок store и адресация ряда.
 *
 * @example
 * ```typescript
 * await using testApp = await buildTest(app);
 *
 * await testApp.call(CreateOrder, { sku: 'x' });
 *
 * expect(testApp.metrics.counter(OrdersMetrics.members.created, { tier: 'paid' }))
 *   .toBe(1);
 * ```
 */
export class TestMetrics {
  readonly #store: MetricsStore;

  /** @internal конструируется только `TestApp` */
  constructor(store: MetricsStore) {
    this.#store = store;
  }

  /**
   * Снимок всех рядов на момент вызова.
   *
   * @returns Ряды со значениями и описанием метрик
   */
  snapshot(): MetricsSnapshot {
    return this.#store.snapshot();
  }

  /**
   * Значение счётчика.
   *
   * Ряда нет — ноль: метрика с открытым атрибутом заводит ряд первой
   * записью, и «не писали» читается как «ноль».
   *
   * @param member - Член группы метрик
   * @param attributes - Атрибуты ряда; частичные отбирают группу рядов
   * @returns Значение ряда, а при частичных атрибутах — сумму подходящих
   */
  counter(member: AnyMember, attributes: MetricAttributes = {}): number {
    return findSeries(this.snapshot(), member, attributes).reduce(
      (total, series) => total + (series.kind === 'counter' ? series.value : 0),
      0,
    );
  }

  /**
   * Агрегат гистограммы одного ряда.
   *
   * @param member - Член группы метрик
   * @param attributes - Атрибуты ряда
   * @returns Ряд с корзинами или `undefined`, если ряда нет
   *
   * @throws {Error} Под атрибуты подходит больше одного ряда
   */
  histogram(
    member: AnyMember,
    attributes: MetricAttributes = {},
  ): HistogramSeries | undefined {
    const series = findSeriesOne(this.snapshot(), member, attributes);

    return series?.kind === 'histogram' ? series : undefined;
  }

  /**
   * Ряды метрики, подходящие под атрибуты.
   *
   * @param member - Член группы метрик
   * @param attributes - Атрибуты, которые ряд обязан нести
   * @returns Ряды в порядке снимка
   */
  series(
    member: AnyMember,
    attributes: MetricAttributes = {},
  ): readonly MetricSeries[] {
    return findSeries(this.snapshot(), member, attributes);
  }
}
