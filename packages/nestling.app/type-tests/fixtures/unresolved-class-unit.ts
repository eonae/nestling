/**
 * Фикстура: декларация с нерезолвленным классом-юнитом отдаётся транспорту.
 *
 * Класс-юнит попадает в `TNeeds` пайплайна и через него — в `TNeeds`
 * декларации; `makeDispatch` принимает только `TNeeds = never`. Гасится
 * `endpoint.resolve(resolver)` или запуском под `App`.
 */

import type { ExtendableContext, EmptyInput } from '@nestlingjs/app';
import { makePipeline, Ok } from '@nestlingjs/app';
import { makeDispatch } from '@nestlingjs/app';
import { httpEndpoint } from '@nestlingjs/transport.http';

class WithTracing {
  handle(_ctx: ExtendableContext<EmptyInput>): { traceId: string } {
    return { traceId: 'trace-1' };
  }
}

const endpoint = httpEndpoint({
  method: 'GET',
  path: '/health',
  pipeline: makePipeline().pre(WithTracing),
  handler: async () => new Ok({ status: 'up' }),
});

makeDispatch([endpoint]);
