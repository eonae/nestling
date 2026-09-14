/**
 * Типовые тесты совместимости с готовыми экспортёрами.
 *
 * Файл не гоняется jest'ом: он и есть тест — если формы разойдутся,
 * упадёт `tsc` на сборке пакета.
 *
 * Проверяется то, ради чего значения собираются формами SDK: экспортёры
 * OTLP по HTTP подходят опциям `traces` и `metrics` как есть, без
 * переходника. Сети здесь нет — экземпляры создаются, но не зовутся.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { otel } from './otel.js';
import { pointsOf } from './points.js';
import { OpenSpan } from './readable.js';

import type { EndpointMeta, TraceContext } from '@nestlingjs/app';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

/** Готовые экспортёры приходят опциями значениями */
const telemetry = otel({
  service: 'users',
  traces: new OTLPTraceExporter(),
  metrics: new OTLPMetricExporter(),
});

const trace: TraceContext = {
  traceId: '0'.repeat(32),
  spanId: '0'.repeat(16),
  sampled: true,
};

const endpoint: EndpointMeta = { transport: 'http', pattern: 'GET /users' };

const resource = resourceFromAttributes({ 'service.name': 'users' });

/** Закрытый участок принимает любой `SpanExporter` */
const spans = (exporter: SpanExporter): void => {
  exporter.export(
    [new OpenSpan(trace, endpoint).close('completed', resource)],
    () => {
      return;
    },
  );
};

/** Точки снимка принимает любой `PushMetricExporter` */
const points = (exporter: PushMetricExporter): void => {
  exporter.export(pointsOf([], resource, [0, 0], [1, 0]), () => {
    return;
  });
};
