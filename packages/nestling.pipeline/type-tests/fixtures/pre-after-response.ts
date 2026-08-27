/**
 * Фикстура: `.pre` после ответного метода.
 *
 * Type-state билдера: первый ответный метод закрывает pre-тракт
 * (`PhasedPipeline` словаря `.pre` не имеет).
 */

import { makePipeline, withRequestId } from '@nestling/pipeline';

export const phased = makePipeline()
  .catch(() => {
    /* noop */
  })
  .pre(withRequestId());
