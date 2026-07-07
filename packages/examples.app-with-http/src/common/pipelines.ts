import {
  compose,
  makePipeline,
  validate,
  withRequestId,
} from '@nestling/pipeline';

/**
 * Внешний слой: наблюдаемость.
 *
 * Демонстрирует ответный тракт pipeline v2: `.finally` — наблюдатель
 * исхода (completed | disconnected | aborted | failed), вызывается всегда,
 * последним. На error-path собственные поля слоя опциональны (requestId
 * мог не успеть добавиться), поэтому `?? 'n/a'`.
 */
const observability = makePipeline()
  .pre(withRequestId())
  .finally((outcome, _res, ctx) => {
    // eslint-disable-next-line no-console
    console.log(
      `[audit] ${ctx.raw.pattern} → ${outcome} (requestId=${ctx.input.requestId ?? 'n/a'})`,
    );
  });

/**
 * Внутренний слой: валидация payload.
 *
 * `makePipeline<{ requestId: string }>()` объявляет требование к внешнему
 * контексту — компилятор проверяет его в точке композиции.
 */
const validation = makePipeline<{ requestId: string }>().pre(validate());

/**
 * Базовый pipeline с валидацией
 *
 * ✅ Содержит validate() - можно использовать с endpoint'ами, у которых есть input схема
 */
export const basePipeline = compose(observability, validation);

/**
 * Pipeline без валидации (для endpoint'ов без input или streaming)
 *
 * ❌ НЕ содержит validate() - можно использовать только с endpoint'ами БЕЗ input схемы
 */
export const noValidationPipeline = observability;
