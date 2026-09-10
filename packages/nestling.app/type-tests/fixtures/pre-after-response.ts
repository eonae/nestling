/**
 * Фикстура: `.pre` после ответного метода.
 *
 * Type-state билдера: после первого ответного метода `.pre` недоступен
 * (у `PhasedPipeline` нет метода `.pre`).
 */

import { makePipeline, withRequestId } from '@nestlingjs/app';

export const phased = makePipeline()
  .catch(() => {
    /* noop */
  })
  .pre(withRequestId());
