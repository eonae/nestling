/**
 * Способности транспорта и fail-fast форм в конструкторе декларации.
 */

import { makeEndpoint } from '../../metadata/endpoint.js';
import { Ok } from '../result.js';

import type { TransportCapabilities } from './capabilities.js';
import { assertFormsSupported } from './capabilities.js';
import { events, multipart, stream, upload } from './forms.js';

import { makeToken } from '@nestling/container';
import { z } from 'zod';

const Row = z.object({ id: z.string() });

/** Токен транспорта фикстур: декларация ссылается на транспорт значением */
const TestTransport$ = makeToken('transport:test');

/** Пустой поток строк — легальный возврат ручки с `output: stream(Row)` */
async function* noRows(): AsyncIterableIterator<{ id: string }> {
  // намеренно пуст
}

const HTTP_LIKE: TransportCapabilities = {
  input: new Set(['value', 'stream', 'multipart']),
  output: new Set(['value', 'stream', 'events']),
};

const BUS_LIKE: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

const definition = (
  input?: unknown,
  output?: unknown,
): {
  transport: string;
  pattern: string;
  input?: unknown;
  output?: unknown;
} => ({
  transport: 'bus',
  pattern: 'orders.create',
  input,
  output,
});

describe('assertFormsSupported', () => {
  it('поддерживаемая форма проходит', () => {
    expect(() =>
      assertFormsSupported(
        { ...definition(stream(Row), events(Row)), transport: 'http' },
        HTTP_LIKE,
      ),
    ).not.toThrow();
  });

  it('называет ручку, транспорт, слот, форму и список поддерживаемых', () => {
    expect(() =>
      assertFormsSupported(definition(undefined, stream(Row)), BUS_LIKE),
    ).toThrow(
      /Endpoint 'orders\.create': transport 'bus' does not support form 'stream' in 'output' \(supported: value\)/,
    );
  });

  it('уточнение контекста попадает в текст', () => {
    expect(() =>
      assertFormsSupported(
        definition(multipart({ files: { f: upload() } })),
        BUS_LIKE,
        "declared in module 'module:orders'",
      ),
    ).toThrow(/declared in module 'module:orders'/);
  });

  it('форма значения проходит везде', () => {
    expect(() =>
      assertFormsSupported(definition(Row, Row), BUS_LIKE),
    ).not.toThrow();
  });
});

describe('fail-fast форм в конструкторе декларации', () => {
  const base = {
    transport: TestTransport$,
    pattern: 'POST /x',
    handle: async () => new Ok({}),
  };

  /**
   * Нетипизированный вход: типы эти случаи уже отсекают
   * (`ValidateOutputForm`), а рантайм обязан дублировать проверку для
   * JS-потребителей — именно её здесь и проверяем.
   */
  const declare = makeEndpoint as unknown as (
    options: Record<string, unknown>,
  ) => unknown;

  it('multipart в output отвергается с указанием слота и формы', () => {
    expect(() =>
      declare({
        ...base,
        output: multipart({ files: { report: upload() } }),
      }),
    ).toThrow(
      /Endpoint 'POST \/x': form 'multipart' is input-only and cannot be declared in 'output'/,
    );
  });

  it('upload() вне multipart отвергается', () => {
    expect(() => declare({ ...base, input: upload() })).toThrow(
      /'upload\(\)' in 'input' is not a form/,
    );
  });

  it('тип-меняющий шаг цепочки в output отвергается и рантаймом', () => {
    expect(() => declare({ ...base, output: stream(Row).batch(10) })).toThrow(
      /'\.batch\(\)' changes the item type and is not allowed in 'output'/,
    );
  });

  it('легальные формы проходят', () => {
    expect(() =>
      makeEndpoint({
        transport: TestTransport$,
        pattern: 'POST /x',
        input: multipart({ files: { report: upload() } }),
        output: stream(Row).tap((): void => undefined),
        handle: async () => new Ok(noRows()),
      }),
    ).not.toThrow();
  });
});
