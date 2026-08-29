/**
 * Фикстура: `.pre` после ответного метода.
 *
 * Type-state билдера: после первого ответного метода `.pre` недоступен
 * (у `PhasedPipeline` нет метода `.pre`).
 */

import { makePipeline, withRequestId } from '@nestling/pipeline';

export const phased = makePipeline()
  .catch(() => {
    /* noop */
  })
  .pre(withRequestId());
