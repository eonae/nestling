import type { EmptyInput, PreUnitFn } from '@nestling/pipeline';

/**
 * Кладёт в контекст момент начала обработки запроса.
 *
 * Поле `startedAt` дальше читают хендлер через `meta` и юниты ответной
 * фазы через `ctx.input`.
 */
export const withStartedAt: PreUnitFn<
  EmptyInput,
  { startedAt: number }
> = () => ({ startedAt: Date.now() });
