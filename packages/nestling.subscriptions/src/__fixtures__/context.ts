/**
 * Контекст запроса без пайплайна — фикстура тестов реестра.
 *
 * Реестр от пайплайна не зависит: ему нужны `endpoint`, `signal` и
 * `summary`. Собирать их тем же `makeEmptyContext`, которым пользуется
 * транспорт, честнее, чем городить объект руками.
 */

import type { AnyOutput } from '@nestling/operations';
import type { AnyInput, ExtendableContext } from '@nestling/pipeline';
import { makeEmptyContext } from '@nestling/pipeline';

export interface ContextOptions {
  transport?: string;
  pattern?: string;
  output?: AnyOutput;
  signal?: AbortSignal;
  input?: AnyInput;
}

/** Контекст запроса к отслеживаемому endpoint'у */
export function makeCtx(
  options: ContextOptions = {},
): ExtendableContext<AnyInput> {
  const transport = options.transport ?? 'http';
  const pattern = options.pattern ?? 'GET /api/feed';

  return makeEmptyContext<AnyInput>(
    { transport, pattern, payload: undefined, attributes: {} },
    { transport, pattern, output: options.output },
    options.signal,
    options.input ?? {},
  );
}
