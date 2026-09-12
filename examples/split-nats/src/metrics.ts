/**
 * Адаптер метрик с форматом Prometheus и endpoint `/metrics`.
 *
 * Адаптер живёт в примере, а не в ядре: ядро не знает, куда уходят числа,
 * и знать не должно. Этим файлом проверяется обратное — что публичной
 * границы ядра (`Metrics`, опция `makeApp({ metrics })`) хватает
 * стороннему экспортёру.
 *
 * Гистограмма выражена парой `_count`/`_sum`: корзин ядро не задаёт, а
 * среднее по ним считается делением. Настоящему экспортёру нужны корзины;
 * их он заведёт у себя — интерфейс ядра этому не мешает.
 */

import type { MetricAttributes, Metrics, Plugin } from '@nestlingjs/app';
import { makePlugin, Ok } from '@nestlingjs/app';
import { Handler, makeToken, valueProvider } from '@nestlingjs/container';
import { httpEndpoint } from '@nestlingjs/transport.http';

/** Адаптер: пишет метрики и отдаёт их текстом формата Prometheus */
export interface MetricsExporter extends Metrics {
  /** Все накопленные метрики в формате экспозиции Prometheus */
  render(): string;
}

/** DI-токен адаптера: его читает endpoint `/metrics` */
export const MetricsExporter$ = makeToken<MetricsExporter>('MetricsExporter');

/** Имя метрики в форме Prometheus: точки — разделители в именах ядра */
const nameOf = (name: string): string => name.replaceAll('.', '_');

/** Метки записи в форме Prometheus, отсортированные для стабильной строки */
function labelsOf(attributes: MetricAttributes): string {
  const pairs = Object.entries(attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${key}="${String(value).replaceAll('"', String.raw`\"`)}"`,
    );

  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`;
}

/** Ключ ряда: имя плюс метки — то, по чему экспортёр складывает значения */
const keyOf = (name: string, attributes: MetricAttributes): string =>
  `${nameOf(name)}${labelsOf(attributes)}`;

/** Создаёт адаптер: счётчики суммой, гистограммы парой `_count`/`_sum` */
export function prometheusExporter(): MetricsExporter {
  const counters = new Map<string, number>();
  const histograms = new Map<string, { count: number; sum: number }>();

  return {
    counter: (name, value = 1, attributes = {}) => {
      const key = keyOf(name, attributes);

      counters.set(key, (counters.get(key) ?? 0) + value);
    },

    histogram: (name, value, attributes = {}) => {
      const key = keyOf(name, attributes);
      const row = histograms.get(key) ?? { count: 0, sum: 0 };

      histograms.set(key, { count: row.count + 1, sum: row.sum + value });
    },

    render: () => {
      const lines: string[] = [];

      for (const [key, value] of counters) {
        lines.push(`${key} ${value}`);
      }

      for (const [key, { count, sum }] of histograms) {
        // Метки уже в ключе, поэтому суффикс вставляется перед ними
        const [name, labels = ''] = key.split(/(?={)/);

        lines.push(
          `${name}_count${labels} ${count}`,
          `${name}_sum${labels} ${sum.toFixed(3)}`,
        );
      }

      return `${lines.join('\n')}\n`;
    },
  };
}

/**
 * Плагин метрик: endpoint `/metrics` и адаптер узлом графа.
 *
 * Адаптер приходит значением, потому что его же получает опция
 * `makeApp({ metrics })`: корень метрик и узел, который их отдаёт, —
 * один и тот же объект.
 *
 * @param exporter - Адаптер, созданный корнем
 */
export function metricsPlugin(exporter: MetricsExporter): Plugin {
  @Handler([MetricsExporter$])
  class MetricsHandler {
    constructor(private readonly exporter: MetricsExporter) {}

    async handle() {
      return new Ok(this.exporter.render());
    }
  }

  return makePlugin({
    name: 'split-nats-metrics',
    providers: [valueProvider(MetricsExporter$, exporter)],
    endpoints: [
      httpEndpoint.get('/metrics', {
        output: 'text',
        // Метрики снимает сборщик, а не клиент API: ни слой запроса, ни
        // строка в документе ему не нужны
        detached: 'metrics scrape: not part of the application API',
        handler: MetricsHandler,
      }),
    ],
  });
}
