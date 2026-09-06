import { collect, untilAborted } from './abort.js';
import {
  batch,
  filter,
  gapTimeout,
  limit,
  tap,
  throttle,
} from './combinators.js';
import { StreamGapTimeoutError, StreamLimitError } from './errors.js';

async function* from<T>(items: readonly T[]): AsyncIterableIterator<T> {
  for (const item of items) {
    yield item;
  }
}

/** Источник, который отмечает своё закрытие: проверка `return()`-операции */
function tracked<T>(items: readonly T[]): {
  source: AsyncIterableIterator<T>;
  closed: () => boolean;
} {
  let finished = false;

  async function* generate(): AsyncIterableIterator<T> {
    try {
      for (const item of items) {
        yield item;
      }
    } finally {
      finished = true;
    }
  }

  return { source: generate(), closed: () => finished };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const even = (n: number): boolean => n % 2 === 0;

const noop = (): void => undefined;

/** Источник, который замолкает после первого элемента */
async function* silent(): AsyncIterableIterator<number> {
  yield 1;
  await delay(50);
  yield 2;
}

describe('комбинаторы item-цепочки', () => {
  it('tap наблюдает каждый элемент, не меняя поток', async () => {
    const seen: number[] = [];
    const result = await collect(tap(from([1, 2, 3]), (n) => seen.push(n)));

    expect(result).toEqual([1, 2, 3]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('filter отбрасывает элементы', async () => {
    const result = await collect(
      filter(from([1, 2, 3, 4]), (n) => n % 2 === 0),
    );

    expect(result).toEqual([2, 4]);
  });

  it('порядок применения значим: filter до limit и после него', async () => {
    // filter → limit: лимит считает уже отфильтрованные элементы
    expect(
      await collect(limit(filter(from([1, 2, 3, 4, 5]), even), 3)),
    ).toEqual([2, 4]);

    // limit → filter: лимит считает всё, что пришло из источника
    expect(await collect(filter(limit(from([1, 2, 3]), 3), even))).toEqual([2]);
  });

  it('limit пропускает ровно max элементов и отказывает на следующем', async () => {
    await expect(collect(limit(from([1, 2, 3]), 2))).rejects.toBeInstanceOf(
      StreamLimitError,
    );

    expect(await collect(limit(from([1, 2]), 2))).toEqual([1, 2]);
  });

  it('limit отказывает фабрикой вызывающего', async () => {
    const marker = new Error('custom');

    await expect(collect(limit(from([1, 2]), 1, () => marker))).rejects.toBe(
      marker,
    );
  });

  it('gapTimeout отказывает при молчании источника', async () => {
    await expect(collect(gapTimeout(silent(), 10))).rejects.toBeInstanceOf(
      StreamGapTimeoutError,
    );
  });

  it('gapTimeout пропускает поток, укладывающийся в интервал', async () => {
    expect(await collect(gapTimeout(from([1, 2, 3]), 50))).toEqual([1, 2, 3]);
  });

  it('batch группирует и отдаёт остаток на завершении потока', async () => {
    expect(await collect(batch(from([1, 2, 3, 4, 5]), 2))).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it('throttle разводит элементы во времени, ничего не теряя', async () => {
    const started = Date.now();
    const result = await collect(throttle(from([1, 2, 3]), 100));

    expect(result).toEqual([1, 2, 3]);
    // Три элемента при 100/сек — минимум два интервала по 10мс
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('прекращение итерации закрывает источник', async () => {
    const { source, closed } = tracked([1, 2, 3]);

    for await (const item of tap(source, noop)) {
      if (item === 1) {
        break;
      }
    }

    expect(closed()).toBe(true);
  });

  it('untilAborted завершает итерацию по сигналу и закрывает источник', async () => {
    const controller = new AbortController();
    let closedFlag = false;

    async function* endless(): AsyncIterableIterator<number> {
      try {
        for (let i = 0; ; i++) {
          await delay(5);
          yield i;
        }
      } finally {
        closedFlag = true;
      }
    }

    const received: number[] = [];
    for await (const item of untilAborted(endless(), controller.signal)) {
      received.push(item);
      if (received.length === 2) {
        controller.abort();
      }
    }

    expect(received).toHaveLength(2);
    expect(closedFlag).toBe(true);
  });

  it('untilAborted на уже взведённом сигнале не отдаёт ничего', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      await collect(untilAborted(from([1, 2]), controller.signal)),
    ).toEqual([]);
  });
});
