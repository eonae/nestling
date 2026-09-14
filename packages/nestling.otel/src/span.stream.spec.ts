/**
 * Участок потокового ответа закрывается после доставки.
 *
 * У endpoint'а с потоковым выходом `.finally`-шаг вызывается после
 * закрытия итератора, поэтому длительность участка покрывает доставку, а
 * не работу хендлера.
 */

import { CollectedSpans } from './__fixtures__/exporters.js';
import { run } from './__fixtures__/run.js';
import { otel } from './otel.js';

import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  compose,
  makePipeline,
  Ok,
  stream,
  withTracing,
} from '@nestlingjs/app';

const traces = new CollectedSpans();

const spans = compose(
  makePipeline().pre(withTracing()),
  otel({ service: 'users', traces }).spans,
);

/** Поток из двух элементов с задержкой между ними */
async function* rows(): AsyncIterableIterator<string> {
  yield 'a';
  await new Promise((resolve) => setTimeout(resolve, 10));
  yield 'b';
}

/** Вычитывает поток целиком: предмет проверки — момент закрытия участка */
const drain = async (response: unknown): Promise<void> => {
  const { value } = response as { value: AsyncIterable<unknown> };

  for await (const item of value) {
    void item;
  }
};

beforeEach(() => {
  traces.spans.length = 0;
});

describe('участок потокового ответа', () => {
  it('уходит экспортёру после закрытия итератора', async () => {
    const response = await run(
      spans,
      async () => new Ok(rows()),
      undefined,
      stream('text'),
    );

    expect(traces.spans).toHaveLength(0);

    await drain(response);

    expect(traces.spans).toHaveLength(1);
  });

  it('длительность покрывает доставку, а не работу хендлера', async () => {
    const response = await run(
      spans,
      async () => new Ok(rows()),
      undefined,
      stream('text'),
    );

    await drain(response);

    const [seconds, nanos] = traces.only().duration;

    expect(seconds * 1e9 + nanos).toBeGreaterThanOrEqual(10e6);
  });
});
