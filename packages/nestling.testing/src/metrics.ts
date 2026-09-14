/**
 * Чтение метрик тестового приложения.
 *
 * Перехватывать нечего: записи лежат в store приложения, и тест читает
 * его снимок. Ряд адресуется членом группы и атрибутами, поэтому опечатка
 * в имени метрики в тесте так же невыразима, как в коде.
 */

import type {
  AnyMember,
  AnyMetricsGroup,
  HistogramSeries,
  MetricAttributes,
  MetricSeries,
  MetricsOf,
  MetricsSnapshot,
  MetricsStore,
} from '@nestlingjs/app';
import { MetricsStore as MetricsStoreClass } from '@nestlingjs/app';
import {
  findSeries,
  findSeriesOne,
  makeCatalog,
  makeWriter,
} from '@nestlingjs/app/testing';

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

/** Писатель группы и чтение его записей — для теста без приложения */
export interface GroupMetrics<G extends AnyMetricsGroup> {
  /** Писатель группы: его принимает класс, который метрику пишет */
  readonly metrics: MetricsOf<G>;

  /** Чтение накопленного: тот же доступ, что у тестового приложения */
  readonly read: TestMetrics;
}

/**
 * Писатель одной группы для теста класса без контейнера.
 *
 * Юнит-тест создаёт класс через `new`, а писателя обычно раздаёт граф.
 * Здесь он собирается из каталога с одной группой — тем же кодом, что и
 * на сборке приложения.
 *
 * @param group - Группа метрик
 * @returns Писателя и чтение его записей
 *
 * @example
 * ```typescript
 * const users = metricsFor(UsersMetrics);
 * const handler = new CreateUserHandler(repo, hub(), users.metrics);
 *
 * await handler.handle({ name: 'Carol', email: 'carol@example.com' });
 *
 * expect(users.read.counter(UsersMetrics.members.created, { outcome: 'stored' }))
 *   .toBe(1);
 * ```
 */
export function metricsFor<G extends AnyMetricsGroup>(
  group: G,
): GroupMetrics<G> {
  const store = new MetricsStoreClass(
    makeCatalog([{ group, owner: 'unit test' }]),
  );

  return { metrics: makeWriter(group, store), read: new TestMetrics(store) };
}
