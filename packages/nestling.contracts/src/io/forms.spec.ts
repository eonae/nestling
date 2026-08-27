/**
 * Формы io: вывод типов payload, иммутабельность цепочек, описатель и
 * media types.
 */

import {
  describeForm,
  events,
  isForm,
  isUploadSpec,
  mediaTypeOf,
  multipart,
  stream,
  upload,
} from './forms.js';
import type { FilePart, InferInput, InferOutput } from './io.js';

import { z } from 'zod';

const LogChunk = z.object({ level: z.string(), text: z.string() });
type LogChunk = z.infer<typeof LogChunk>;

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

/**
 * Тип-утверждение: взаимная присваиваемость.
 *
 * Не строгая идентичность: маппированный тип (`FilesOf`) и написанный
 * руками литерал взаимозаменяемы для пользователя, но идентичными
 * компилятор их не считает — а проверяем мы именно то, что видит автор
 * хендлера.
 */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
function expectType<T extends true>(assertion?: T): void {
  // Проверку делает компилятор; параметр объявлен, чтобы тип-аргумент был
  // использован — иначе он справедливо считается мёртвым
  void assertion;
}

/**
 * Хелпер-фабрика цепочки: доказывает, что форму можно собирать функцией и
 * переиспользовать — ради этого комбинаторы и возвращают новое значение.
 */
const guarded = <T extends z.ZodType>(
  schema: T,
): ReturnType<typeof stream<T>> =>
  stream(schema).limit(50_000).gapTimeout(30_000);

describe('вывод типов payload по форме', () => {
  it('значение-схема выводится как раньше', () => {
    expectType<Equals<InferInput<typeof Row>, Row>>();
    expectType<Equals<InferOutput<typeof Row>, Row>>();
  });

  it('примитивы остаются листьями', () => {
    expectType<Equals<InferInput<'binary'>, Buffer>>();
    expectType<Equals<InferInput<'text'>, string>>();
  });

  it('поток даёт стандартный AsyncIterableIterator', () => {
    expectType<
      Equals<
        InferInput<ReturnType<typeof stream<typeof LogChunk>>>,
        AsyncIterableIterator<LogChunk>
      >
    >();
    expectType<
      Equals<
        InferOutput<ReturnType<typeof events<typeof Row>>>,
        AsyncIterable<Row>
      >
    >();
  });

  it('.batch на входе меняет тип хендлера', () => {
    const form = stream(LogChunk).batch(100);

    expect(form.chain.at(-1)).toEqual({ op: 'batch', size: 100 });
    expectType<
      Equals<InferInput<typeof form>, AsyncIterableIterator<LogChunk[]>>
    >();
  });

  it('multipart выводится как { fields, files } с файлами по именам', () => {
    const form = multipart({
      fields: z.object({ title: z.string() }),
      files: {
        avatar: upload({ maxSize: 1024 }),
        pages: upload({ multiple: true }),
      },
    });

    expect(Object.keys(form.files)).toEqual(['avatar', 'pages']);
    expectType<
      Equals<
        InferInput<typeof form>,
        {
          fields: { title: string };
          files: { avatar: FilePart; pages: FilePart[] };
        }
      >
    >();
  });

  it('посторонний объект не принимается за форму', () => {
    const impostor = { kind: 'stream', leaf: LogChunk };

    expect(isForm(impostor)).toBe(false);
    // Трактуется как обычное значение-схема, а не как поток
    expect(describeForm(impostor).kind).toBe('value');
  });
});

describe('форма — неизменяемое брендированное значение', () => {
  it('бренд неперечислим и не сериализуется', () => {
    const form = stream(LogChunk);

    expect(isForm(form)).toBe(true);
    expect(Object.keys(form)).not.toContain('nestling:io-form');
    expect(JSON.stringify(form)).not.toContain('io-form');
  });

  it('комбинатор возвращает новую форму, исходную не трогая', () => {
    const base = stream(LogChunk);
    const limited = base.limit(10);

    expect(base.chain).toHaveLength(0);
    expect(limited.chain).toHaveLength(1);
    expect(limited).not.toBe(base);
  });

  it('хелпер переиспользуется: две декларации получают независимые формы', () => {
    const logs = guarded(LogChunk).filter(() => true);
    const rows = guarded(Row);

    expect(logs.chain).toHaveLength(3);
    expect(rows.chain).toHaveLength(2);
  });

  it('шаги цепочки идут в порядке объявления', () => {
    const form = stream(LogChunk)
      .filter(() => true)
      .limit(10)
      .gapTimeout(1000)
      .throttle(5);

    expect(form.chain.map((step) => step.op)).toEqual([
      'filter',
      'limit',
      'gapTimeout',
      'throttle',
    ]);
  });
});

describe('опции поэлементной валидации', () => {
  it('по умолчанию валидируем и отказываем', () => {
    expect(stream(LogChunk).items).toEqual({
      validate: true,
      onInvalid: 'fail',
    });
  });

  it('opt-out виден в декларации', () => {
    expect(stream(LogChunk, { validate: false }).items.validate).toBe(false);
    expect(stream(LogChunk, { onInvalid: 'skip' }).items.onInvalid).toBe(
      'skip',
    );
  });
});

describe('describeForm', () => {
  it('схема без обёртки — форма значения', () => {
    expect(describeForm(Row)).toEqual({ kind: 'value', leaf: Row });
  });

  it('отсутствие input — форма значения без листа', () => {
    expect(describeForm()).toEqual({ kind: 'value' });
  });

  it('примитив — лист формы значения', () => {
    expect(describeForm('binary')).toEqual({ kind: 'value', leaf: 'binary' });
  });

  it('различает stream и events', () => {
    expect(describeForm(stream(Row)).kind).toBe('stream');
    expect(describeForm(events(Row)).kind).toBe('events');
  });

  it('multipart несёт схему полей и спецификации файлов', () => {
    const form = describeForm(
      multipart({ files: { avatar: upload({ mime: ['image/png'] }) } }),
    );

    expect(form.kind).toBe('multipart');
    expect(isUploadSpec(form.files?.avatar)).toBe(true);
    expect(form.files?.avatar).toEqual({
      mime: ['image/png'],
      multiple: false,
    });
  });
});

describe('media types выводятся из формы', () => {
  it.each([
    [undefined, 'application/json'],
    [Row, 'application/json'],
    ['binary', 'application/octet-stream'],
    ['text', 'text/plain'],
  ])('%p → %s', (io, expected) => {
    expect(mediaTypeOf(io)).toBe(expected);
  });

  it('stream → NDJSON, events → SSE, multipart → form-data', () => {
    expect(mediaTypeOf(stream(Row))).toBe('application/x-ndjson');
    expect(mediaTypeOf(events(Row))).toBe('text/event-stream');
    expect(mediaTypeOf(multipart({ files: { f: upload() } }))).toBe(
      'multipart/form-data',
    );
  });
});

describe('fail-fast конструкторов форм', () => {
  it('потоковая форма без листа отвергается сразу', () => {
    expect(() => stream(undefined as never)).toThrow(/a leaf is required/);
    expect(() => events(undefined as never)).toThrow(/a leaf is required/);
  });

  it('не-upload в files отвергается', () => {
    expect(() => multipart({ files: { avatar: {} as never } })).toThrow(
      /is not an upload\(\) specification/,
    );
  });
});
