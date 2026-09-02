/* eslint-disable @typescript-eslint/no-empty-function --
 * noop-юниты — легитимная часть тестов порядка исполнения */
/**
 * Провенанс композиции: ссылки на значения, из которых произошёл пайплайн.
 *
 * Предмет проверки — идентичность слоя, на которой стоит policy-check
 * (`everyEndpoint(...).hasLayer(...)`): она ссылочная, транзитивная и не
 * зависит ни от имён, ни от состава юнитов. Плюс контрольный тест
 * неизменности исполнения: провенанс не участвует в рантайме.
 */

import type { EndpointMeta, ExtendableContext } from './types/context';
import { makeEmptyContext } from './types/context';
import type { Raw } from './types/raw';
import type { AnyPipeline, Pipeline } from './pipeline';
import { compose, derivesFrom, makePipeline } from './pipeline';

import type { AnyInput, EmptyInput } from '@nestling/operations';
import { Ok } from '@nestling/operations';

function makeCtx(): ExtendableContext<EmptyInput> {
  const raw: Raw = {
    transport: 'test',
    pattern: 'TEST /',
    payload: undefined,
    attributes: {},
  };

  const endpoint: EndpointMeta = {
    transport: 'test',
    pattern: 'TEST /',
  };

  return makeEmptyContext(raw, endpoint);
}

/** Один и тот же юнит в двух разных слоях: идентичность у слоя, не у юнита */
const sharedUnit = (): void => {};

/** Исполняет пайплайн так же, как это делает транспорт */
async function run(pipeline: AnyPipeline, handler: () => unknown) {
  const executable = pipeline as unknown as Pipeline<
    EmptyInput,
    AnyInput,
    never
  >;

  return executable.executeWithHandler(
    handler,
    makeCtx() as ExtendableContext<AnyInput>,
    { onUnknownFail: () => {} },
  );
}

describe('провенанс композиции', () => {
  it('compose записывает оба слоя-аргумента', () => {
    const base = makePipeline().pre(() => {});
    const authed = makePipeline().pre(() => {});

    const pipeline = compose(base, authed);

    expect(derivesFrom(pipeline, base)).toBe(true);
    expect(derivesFrom(pipeline, authed)).toBe(true);
  });

  it('вложенная композиция транзитивна', () => {
    const base = makePipeline().pre(() => {});
    const authed = makePipeline().pre(() => {});
    const extra = makePipeline().pre(() => {});

    const inner = compose(base, authed);
    const pipeline = compose(inner, extra);

    for (const layer of [base, authed, extra, inner]) {
      expect(derivesFrom(pipeline, layer)).toBe(true);
    }
  });

  it('деривация билдера помнит предшественника, а его самого не меняет', () => {
    const authed = makePipeline().pre(() => {});

    const extended = authed.pre(() => {}).ok(() => {});

    expect(derivesFrom(extended, authed)).toBe(true);
    // Значение иммутабельно: исходный слой производным не «заразился»
    expect(derivesFrom(authed, extended)).toBe(false);
  });

  it('пайплайн содержит сам себя', () => {
    const base = makePipeline().pre(() => {});

    expect(derivesFrom(base, base)).toBe(true);
  });

  it('bind сохраняет несвязанный оригинал', () => {
    class TrackUnit {
      handle(): void {}
    }

    const authed = makePipeline().pre(TrackUnit);
    const composed = compose(makePipeline(), authed);

    const bound = (composed as unknown as Pipeline<EmptyInput>).bind(
      () => new TrackUnit(),
    );

    expect(derivesFrom(bound, composed)).toBe(true);
    expect(derivesFrom(bound, authed)).toBe(true);
  });

  it('чужой слой с тем же составом юнитов не содержится', () => {
    const authed = makePipeline().pre(sharedUnit);
    const lookalike = makePipeline().pre(sharedUnit);

    const pipeline = compose(makePipeline(), authed);

    expect(derivesFrom(pipeline, authed)).toBe(true);
    expect(derivesFrom(pipeline, lookalike)).toBe(false);
  });

  it('не-пайплайн слоем не считается', () => {
    const base = makePipeline().pre(() => {});

    expect(derivesFrom(base, {})).toBe(false);
    expect(derivesFrom(undefined, base)).toBe(false);
  });
});

describe('провенанс не влияет на исполнение', () => {
  it('порядок pre-трактов, ответных фаз и finally на трёх слоях прежний', async () => {
    const events: string[] = [];

    const track = (name: string) => (): void => {
      events.push(name);
    };

    const outer = makePipeline()
      .pre(track('pre:outer'))
      .ok(track('ok:outer'))
      .finally(track('finally:outer'));

    const middle = makePipeline()
      .pre(track('pre:middle'))
      .ok(track('ok:middle'))
      .finally(track('finally:middle'));

    const inner = makePipeline()
      .pre(track('pre:inner'))
      .ok(track('ok:inner'))
      .catch(track('catch:inner'))
      .finally(track('finally:inner'));

    const response = await run(compose(outer, middle, inner), () => {
      events.push('handler');
      return new Ok({ done: true });
    });

    expect(response.isSuccess).toBe(true);
    // Pre выполняется снаружи внутрь, ответная фаза и finally — изнутри
    // наружу. `catch` при успехе не исполняется.
    expect(events).toEqual([
      'pre:outer',
      'pre:middle',
      'pre:inner',
      'handler',
      'ok:inner',
      'ok:middle',
      'ok:outer',
      'finally:inner',
      'finally:middle',
      'finally:outer',
    ]);
  });
});
