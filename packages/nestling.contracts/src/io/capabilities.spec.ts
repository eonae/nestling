/**
 * Возможности транспорта: проверка формы декларации против того, что
 * транспорт умеет принимать и отдавать.
 *
 * Проверки форм в конструкторе декларации живут рядом с конструктором:
 * `@nestling/pipeline`, `metadata/endpoint.form-slots.spec.ts`.
 */

import type { TransportCapabilities } from './capabilities.js';
import { assertFormsSupported } from './capabilities.js';
import { events, multipart, stream, upload } from './forms.js';

import { z } from 'zod';

const Row = z.object({ id: z.string() });

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

  it('называет endpoint, транспорт, слот, форму и список поддерживаемых', () => {
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
