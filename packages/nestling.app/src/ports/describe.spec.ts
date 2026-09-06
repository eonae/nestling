/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip здесь и есть предмет проверки: дескриптор обязан
 * пережить сериализацию в JSON, а `structuredClone` пронёс бы через себя
 * и функции */
/**
 * Дескриптор операции: структурная часть точна всегда, листья — ровно
 * настолько, насколько их раскрыл конвертер.
 */

import { canonicalizeJson, describeOperation } from './describe.js';
import { implement } from './implement.js';

import { makeCommand, makeRequest } from '@nestling/operations';
import type { SchemaDocConverter } from '@nestling/pipeline';
import {
  events,
  jsonSchema,
  makeFail,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/pipeline';
import { z } from 'zod';

const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const CardDeclined = makeFail('payment_required:card_declined', {
  message: 'Card declined',
});

const QuotaExceeded = makeFail('too_many_requests:quota_exceeded', {
  message: 'Quota exhausted',
});

const ChargeCard = makeRequest({
  name: 'describe.billing.charge',
  input: z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  // Порядок объявления обратный алфавитному: дескриптор обязан его выровнять
  errors: [QuotaExceeded, CardDeclined],
});

describe('describeOperation', () => {
  it('описывает value-формы JSON Schema, когда конвертер передан', () => {
    const descriptor = describeOperation(ChargeCard, {
      converters: [zodConverter()],
    });

    expect(descriptor.name).toBe('describe.billing.charge');
    expect(descriptor.kind).toBe('request');

    expect(descriptor.input.kind).toBe('value');
    expect(descriptor.input.leaf).toMatchObject({
      leaf: 'schema',
      vendor: 'zod',
      jsonSchema: {
        type: 'object',
        properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
      },
    });

    expect(descriptor.output.leaf).toMatchObject({
      leaf: 'schema',
      jsonSchema: { properties: { chargeId: { type: 'string' } } },
    });
  });

  it('без конвертера сохраняет структурную часть и помечает лист непрозрачным', () => {
    const descriptor = describeOperation(ChargeCard);

    expect(descriptor.kind).toBe('request');
    expect(descriptor.input.kind).toBe('value');
    expect(descriptor.input.leaf).toEqual({ leaf: 'opaque', vendor: 'zod' });
    expect(descriptor.output.leaf).toEqual({ leaf: 'opaque', vendor: 'zod' });

    // Коды отказов от конвертера не зависят — они и есть структурная часть
    expect(descriptor.errors).toEqual([
      { code: 'payment_required:card_declined', category: 'payment_required' },
      {
        code: 'too_many_requests:quota_exceeded',
        category: 'too_many_requests',
      },
    ]);
  });

  it('аннотированный лист описан схемой даже без конвертеров', () => {
    const Annotated = makeRequest({
      name: 'describe.annotated',
      input: jsonSchema(z.object({ id: z.string() }), {
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
    });

    // Ни одного конвертера не передано: ответ на вопрос «как выглядит эта
    // схема» уже дан аннотацией, и терять его незачем
    expect(describeOperation(Annotated).input.leaf).toEqual({
      leaf: 'schema',
      vendor: 'zod',
      jsonSchema: { properties: { id: { type: 'string' } }, type: 'object' },
    });
  });

  it('различает «листа нет» и «лист непрозрачен»', () => {
    const Ping = makeCommand({ name: 'describe.ping' });

    expect(describeOperation(Ping).input.leaf).toEqual({ leaf: 'none' });
    expect(describeOperation(ChargeCard).input.leaf).toEqual({
      leaf: 'opaque',
      vendor: 'zod',
    });
  });

  it('несёт вид потоковой формы выхода', () => {
    const Tail = makeRequest({
      name: 'describe.logs.tail',

      output: stream(z.object({ line: z.string() })),
    });

    const descriptor = describeOperation(Tail, {
      converters: [zodConverter()],
    });

    expect(descriptor.output.kind).toBe('stream');
    expect(descriptor.output.leaf).toMatchObject({ leaf: 'schema' });
  });

  it('несёт примитивный лист и вид `events`', () => {
    const Feed = makeRequest({
      name: 'describe.feed',

      output: events('text'),
    });

    expect(describeOperation(Feed).output).toEqual({
      kind: 'events',
      leaf: { leaf: 'primitive', primitive: 'text' },
    });
  });

  it('раскладывает multipart на поля и файлы с ограничениями', () => {
    const Upload = makeRequest({
      name: 'describe.upload',

      input: multipart({
        fields: z.object({ title: z.string() }),
        files: {
          avatar: upload({ maxSize: 1024, mime: ['image/png', 'image/gif'] }),
          attachments: upload({ multiple: true }),
        },
      }),
    });

    const descriptor = describeOperation(Upload, {
      converters: [zodConverter()],
    });

    expect(descriptor.input.kind).toBe('multipart');
    expect(descriptor.input.fields).toMatchObject({ leaf: 'schema' });
    expect(descriptor.input.files).toEqual({
      attachments: { multiple: true },
      avatar: {
        multiple: false,
        maxSize: 1024,
        mime: ['image/gif', 'image/png'],
      },
    });

    // Файлы отсортированы по имени: снапшот не должен зависеть от порядка
    // ключей в словаре декларации
    expect(Object.keys(descriptor.input.files ?? {})).toEqual([
      'attachments',
      'avatar',
    ]);
  });

  it('описывает декларацию-реализацию так же, как её операция', () => {
    const Impl = implement(ChargeCard, {
      handler: async () => new Ok({ chargeId: '1' }),
    });

    expect(describeOperation(Impl, { converters: [zodConverter()] })).toEqual(
      describeOperation(ChargeCard, { converters: [zodConverter()] }),
    );
  });

  it('переживает сериализацию в JSON без потерь', () => {
    const descriptor = describeOperation(ChargeCard, {
      converters: [zodConverter()],
    });

    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  it('чужое значение отвергает с указанием ожидаемого', () => {
    expect(() => describeOperation({ pattern: 'GET /x' } as never)).toThrow(
      /makeRequest\(\)|implement\(\)/,
    );
  });

  it('дубль вендора в списке конвертеров бросает', () => {
    expect(() =>
      describeOperation(ChargeCard, {
        converters: [zodConverter(), zodConverter()],
      }),
    ).toThrow(/same vendor 'zod'/);
  });
});

describe('canonicalizeJson', () => {
  it('сортирует ключи рекурсивно', () => {
    const canonical = canonicalizeJson({
      b: 1,
      a: { d: [{ z: 1, y: 2 }], c: 3 },
    });

    expect(JSON.stringify(canonical)).toBe(
      '{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}',
    );
  });

  it('выбрасывает `undefined` и функции, не роняя объект', () => {
    expect(canonicalizeJson({ a: 1, b: undefined, c: () => 1 })).toEqual({
      a: 1,
    });
  });
});
