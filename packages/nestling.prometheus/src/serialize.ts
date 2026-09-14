/**
 * Формат экспозиции Prometheus: снимок store — текст ответа.
 *
 * Считать здесь нечего: значения уже накоплены ядром, а корзины
 * гистограммы посчитаны по границам её декларации. Работа сериализатора —
 * назвать ряды так, как их ждёт сборщик.
 */

import type {
  MetricAttributes,
  MetricSeries,
  MetricsSnapshot,
} from '@nestlingjs/app';

/** Имя в форме Prometheus: точки объявления — подчёркивания экспозиции */
const nameOf = (name: string, unit?: string): string => {
  const base = name.replaceAll('.', '_');

  // Единица уходит в имя ряда — так её читают правила и дашборды; имя,
  // уже оканчивающееся на неё, второй раз её не получает
  return unit === undefined || base.endsWith(`_${unit}`)
    ? base
    : `${base}_${unit}`;
};

/** Экранирование значения метки по правилам формата */
const escape = (value: string): string =>
  value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('"', String.raw`\"`)
    .replaceAll('\n', String.raw`\n`);

/**
 * Метки ряда: имена по алфавиту, `le` корзины — последней.
 *
 * Порядок устойчив между запросами, поэтому дифф двух снятий читается
 * глазами, а не только сборщиком. `le` стоит в конце по конвенции
 * формата: это метка корзины, а не атрибут ряда.
 */
function labelsOf(
  attributes: MetricAttributes,
  extra?: readonly [string, string],
): string {
  const pairs = Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escape(String(value))}"`);

  if (extra) {
    pairs.push(`${extra[0]}="${escape(extra[1])}"`);
  }

  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
}

/** Строки одного ряда: счётчик — одна, гистограмма — корзины, сумма и счёт */
function linesOf(series: MetricSeries): string[] {
  const name = nameOf(series.name, series.unit);

  if (series.kind === 'counter') {
    return [`${name}${labelsOf(series.attributes)} ${series.value}`];
  }

  const lines = series.buckets.map(
    ({ le, count }) =>
      `${name}_bucket${labelsOf(series.attributes, ['le', String(le)])} ${count}`,
  );

  lines.push(
    `${name}_bucket${labelsOf(series.attributes, ['le', '+Inf'])} ${series.count}`,
    `${name}_sum${labelsOf(series.attributes)} ${series.sum}`,
    `${name}_count${labelsOf(series.attributes)} ${series.count}`,
  );

  return lines;
}

/**
 * Сериализует снимок в формат экспозиции.
 *
 * Ряды со значением ноль попадают в текст наравне с остальными: в этом и
 * смысл известного сборке набора рядов — дашборд с нулём ошибок отличим
 * от дашборда без данных.
 *
 * @param snapshot - Снимок store
 * @returns Текст экспозиции; пустой снимок даёт пустую строку
 */
export function serialize(snapshot: MetricsSnapshot): string {
  const lines: string[] = [];
  let described: string | undefined;

  for (const series of snapshot) {
    // `# HELP` и `# TYPE` печатаются один раз на метрику, а ряды одной
    // метрики идут в снимке подряд — их порядок задаёт каталог
    if (series.name !== described) {
      described = series.name;

      const name = nameOf(series.name, series.unit);

      if (series.help !== undefined) {
        lines.push(`# HELP ${name} ${series.help.replaceAll('\n', ' ')}`);
      }

      lines.push(`# TYPE ${name} ${series.kind}`);
    }

    lines.push(...linesOf(series));
  }

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
