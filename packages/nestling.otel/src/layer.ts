/**
 * Слой участков: pre-шаг открывает участок, `.finally`-шаг закрывает его.
 *
 * Слой требует трассу во внешнем контексте, поэтому композиция без
 * `withTracing()` выше не компилируется. Своего `withTracing()` слой не
 * содержит: продолжение трассы объявляет приложение, и вторая точка
 * объявления дала бы два идентификатора участка на один запрос.
 *
 * У endpoint'а с потоковым выходом `.finally`-шаг вызывается после
 * закрытия итератора, поэтому длительность участка покрывает доставку
 * целиком.
 */

import type { SpanRequirements, SpansLayer } from './options.js';
import { OpenSpan } from './readable.js';
import { Span } from './span.js';

import { makePipeline } from '@nestlingjs/app';
import type { Resource } from '@opentelemetry/resources';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';

/** Ответ экспортёру: результат отправки разбирает он сам */
const noop = (): void => undefined;

/**
 * Собирает слой участков.
 *
 * Без экспортёра слой работает и политику удовлетворяет, но участки
 * никуда не отправляет: экспорт включается настройкой развёртывания, не
 * трогая композицию приложения.
 *
 * @param resource - Атрибуты ресурса сателлита
 * @param exporter - Куда уходят закрытые участки
 * @returns Слой пайплайна с переменной `Span`
 */
export function makeSpans(
  resource: Resource,
  exporter?: SpanExporter,
): SpansLayer {
  // Слой собирается в переменную, а не возвращается выражением: под
  // аннотацией возврата компилятор перестаёт выводить параметры
  // `.finally`-шага, и они становятся `any`
  const layer = makePipeline<SpanRequirements>()
    .pre(
      Span.provide<SpanRequirements>(
        (ctx) => new OpenSpan(ctx.input.trace, ctx.endpoint),
      ),
    )
    .finally((outcome, _res, ctx) => {
      const { span } = ctx.input;

      if (exporter === undefined || !(span instanceof OpenSpan)) {
        return;
      }

      // Результат отправки разбирает экспортёр: он знает про повторы и
      // пишет причину через `diag` OpenTelemetry. `.finally`-шаг обязан
      // обрабатывать свои ошибки сам, поэтому наружу отсюда не уходит
      // ничего
      exporter.export([span.close(outcome, resource)], noop);
    });

  return layer;
}
