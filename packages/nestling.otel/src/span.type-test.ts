/**
 * Типовые тесты слоя участков.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета.
 *
 * Проверяется требование слоя к внешнему контексту: участок нельзя
 * открыть там, где трассы нет, и компилятор это ловит на композиции, а не
 * на первом запросе.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { otel } from './otel.js';

import {
  compose,
  makePipeline,
  withRequestId,
  withTracing,
} from '@nestlingjs/app';

const telemetry = otel({ service: 'users' });

/** Слой композируется после трассировки */
const traced = compose(makePipeline().pre(withTracing()), telemetry.spans);

/** Трасса может прийти не первым шагом: важен накопленный контекст */
const afterRequestId = compose(
  makePipeline().pre(withRequestId()).pre(withTracing()),
  telemetry.spans,
);

/** Без трассировки слой не компилируется: во внешнем контексте нет `trace` */
const untraced = compose(
  makePipeline().pre(withRequestId()),
  // @ts-expect-error — слой требует `trace`, а внешний слой его не кладёт
  telemetry.spans,
);

/** Пустой внешний слой тоже не подходит */
const bare = compose(
  makePipeline(),
  // @ts-expect-error — слой требует `trace`, а внешний слой пуст
  telemetry.spans,
);
