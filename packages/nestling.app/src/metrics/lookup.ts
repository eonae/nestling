/**
 * Поиск ряда в снимке: адрес — член группы и атрибуты.
 *
 * Читателю снимка (тесту, экспозиции, сателлиту) нужен ряд, а не разбор
 * массива. Адресуется он членом группы, поэтому опечатка в имени метрики
 * невыразима и здесь.
 */

import type { AnyMember } from './declaration.js';
import type {
  MetricAttributes,
  MetricSeries,
  MetricsSnapshot,
} from './sink.js';

/** Атрибуты ряда содержат все заданные значения */
const matches = (series: MetricSeries, attributes: MetricAttributes): boolean =>
  Object.entries(attributes).every(
    ([name, value]) => series.attributes[name] === value,
  );

/**
 * Ряды метрики, подходящие под заданные атрибуты.
 *
 * Атрибуты задаются частично: `{ outcome: 'failed' }` отбирает ряды всех
 * endpoint'ов с этим исходом.
 *
 * @param snapshot - Снимок store
 * @param member - Член группы метрик
 * @param attributes - Атрибуты, которые ряд обязан нести
 * @returns Подходящие ряды в порядке снимка
 */
export function findSeries(
  snapshot: MetricsSnapshot,
  member: AnyMember,
  attributes: MetricAttributes = {},
): readonly MetricSeries[] {
  return snapshot.filter(
    (series) => series.name === member.name && matches(series, attributes),
  );
}

/**
 * Единственный ряд метрики по заданным атрибутам.
 *
 * @param snapshot - Снимок store
 * @param member - Член группы метрик
 * @param attributes - Атрибуты ряда
 * @returns Ряд или `undefined`, если такого ряда в снимке нет
 *
 * @throws {Error} Под атрибуты подходит больше одного ряда
 */
export function findSeriesOne(
  snapshot: MetricsSnapshot,
  member: AnyMember,
  attributes: MetricAttributes = {},
): MetricSeries | undefined {
  const found = findSeries(snapshot, member, attributes);

  if (found.length > 1) {
    throw new Error(
      `Attributes ${JSON.stringify(attributes)} match ${found.length} series ` +
        `of metric '${member.name}'. Name the attributes that tell them ` +
        `apart: ${[...new Set(found.flatMap((series) => Object.keys(series.attributes)))].join(', ')}.`,
    );
  }

  return found[0];
}
