/**
 * Подставные экспортёры: тот же интерфейс, что у настоящих, но вместо
 * сети — список полученного.
 *
 * Спеки проверяют форму значения на границе SDK: участок уходит как
 * `ReadableSpan`, точки — как `ResourceMetrics`. Коллектор в
 * интеграционном прогоне доказал бы то же самое ценой минут сборки, и
 * поднимать его на каждый прогон незачем.
 */

import type {
  PushMetricExporter,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/** Первый аргумент обратного вызова экспортёра: успешная отправка */
const SUCCESS = { code: 0 } as Parameters<
  Parameters<SpanExporter['export']>[1]
>[0];

/** Экспортёр участков, который складывает полученное в список */
export class CollectedSpans implements SpanExporter {
  /** Участки в порядке получения */
  readonly spans: ReadableSpan[] = [];

  /** `shutdown()` был вызван */
  stopped = false;

  export(
    spans: ReadableSpan[],
    resultCallback: (result: typeof SUCCESS) => void,
  ): void {
    this.spans.push(...spans);
    resultCallback(SUCCESS);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
  }

  /** Единственный участок списка; спека падает, если их не один */
  only(): ReadableSpan {
    if (this.spans.length !== 1) {
      throw new Error(`expected exactly one span, got ${this.spans.length}`);
    }

    return this.spans[0] as ReadableSpan;
  }
}

/** Экспортёр метрик, который складывает полученное в список */
export class CollectedPoints implements PushMetricExporter {
  /** Отправки в порядке получения */
  readonly batches: ResourceMetrics[] = [];

  /** `shutdown()` был вызван */
  stopped = false;

  export(
    metrics: ResourceMetrics,
    resultCallback: (result: typeof SUCCESS) => void,
  ): void {
    this.batches.push(metrics);
    resultCallback(SUCCESS);
  }

  async forceFlush(): Promise<void> {
    return undefined;
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
  }

  /** Последняя отправка; спека падает, если отправок не было */
  last(): ResourceMetrics {
    const batch = this.batches.at(-1);

    if (!batch) {
      throw new Error('expected at least one export');
    }

    return batch;
  }
}

/** Экспортёр метрик, который отказывает каждой отправкой */
export class FailingPoints implements PushMetricExporter {
  /** Число попыток отправки */
  attempts = 0;

  export(
    _metrics: ResourceMetrics,
    resultCallback: (result: typeof SUCCESS) => void,
  ): void {
    this.attempts += 1;
    resultCallback({
      ...SUCCESS,
      code: 1,
      error: new Error('collector is unreachable'),
    } as typeof SUCCESS);
  }

  async forceFlush(): Promise<void> {
    return undefined;
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}
