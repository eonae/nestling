/**
 * Fail-fast форм io в конструкторе декларации.
 *
 * Правило (`assertFormSlots`) живёт в `@nestling/operations` вместе с формами;
 * здесь проверяется, что kernel-примитив его применяет — и потому оно
 * одинаково работает для `httpEndpoint`, `cliEndpoint` и прямого вызова.
 */

import { makeEndpoint } from './endpoint.js';

import { makeToken } from '@nestling/container';
import { multipart, Ok, stream, upload } from '@nestling/operations';
import { z } from 'zod';

const Row = z.object({ id: z.string() });

/** Токен транспорта фикстур: декларация ссылается на транспорт значением */
const TestTransport$ = makeToken('transport:test');

/**
 * Пустой поток строк — допустимый возврат endpoint'а с
 * `output: stream(Row)`
 */
async function* noRows(): AsyncIterableIterator<{ id: string }> {
  // намеренно пуст
}

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

  it('допустимые формы проходят', () => {
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
