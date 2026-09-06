import { spyLogger } from '../../logger/__fixtures__/spy.js';
import { makePipeline } from '../core/pipeline.js';
import type { EndpointMeta, Raw } from '../core/types/index.js';
import { makeEmptyContext } from '../core/types/index.js';

import { withRequestLogging } from './logging.js';

import { Ok } from '@nestling/operations';

describe('withRequestLogging', () => {
  it('пишет info о начале обработки с транспортом и паттерном', async () => {
    const spy = spyLogger();
    const pipeline = makePipeline().pre(withRequestLogging(spy.logger));

    const raw: Raw = {
      transport: 'http',
      pattern: 'GET /users',
      payload: undefined,
      attributes: {},
    };
    const endpoint: EndpointMeta = { transport: 'http', pattern: 'GET /users' };

    await pipeline.executeWithHandler(
      () => new Ok(null),
      makeEmptyContext(raw, endpoint, new AbortController().signal),
    );

    expect(spy.entries).toEqual([
      {
        level: 'info',
        message: 'request started',
        fields: { transport: 'http', pattern: 'GET /users' },
      },
    ]);
  });
});
