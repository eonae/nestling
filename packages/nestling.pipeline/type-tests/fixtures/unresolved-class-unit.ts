/**
 * Фикстура: декларация с нерезолвленным классом-юнитом отдаётся транспорту.
 *
 * Класс-юнит попадает в `TNeeds` пайплайна и через него — в `TNeeds`
 * декларации; `route()` принимает только `TNeeds = never`. Гасится
 * `endpoint.resolve(resolver)` или запуском под `App`.
 */

import type { ExtendableContext, EmptyInput } from '@nestling/pipeline';
import { makePipeline, Ok } from '@nestling/pipeline';
import { httpEndpoint, HttpTransport } from '@nestling/transport.http';

class WithTracing {
  handle(_ctx: ExtendableContext<EmptyInput>): { traceId: string } {
    return { traceId: 'trace-1' };
  }
}

const endpoint = httpEndpoint({
  method: 'GET',
  path: '/health',
  pipeline: makePipeline().pre(WithTracing),
  handle: async () => new Ok({ status: 'up' }),
});

const transport = new HttpTransport();

transport.route(endpoint);
