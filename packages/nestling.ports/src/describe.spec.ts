/* eslint-disable unicorn/prefer-structured-clone --
 * JSON round-trip здесь и есть предмет проверки: дескриптор обязан
 * пережить провод, а `structuredClone` пронёс бы через себя и функции */
/**
 * Дескриптор контракта: структурная часть точна всегда, листья — ровно
 * настолько, насколько их раскрыл конвертер.
 */

import { canonicalizeJson, describeContract } from './describe.js';
import { implement } from './implement.js';

import { makeContract } from '@nestling/contracts';
import type { SchemaDocConverter } from '@nestling/pipeline';
import {
  defineFail,
  events,
  jsonSchema,
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

const CardDeclined = defineFail('CARD_DECLINED', {
  status: 'PAYMENT_REQUIRED',
  message: 'Card declined',
});

const QuotaExceeded = defineFail('QUOTA_EXCEEDED', {
  status: 'TOO_MANY_REQUESTS',
  message: 'Quota exhausted',
});

const ChargeCard = makeContract({
  name: 'describe.billing.charge',
  kind: 'request',
  input: z.object({ orderId: z.string(), amount: z.number() }),
  output: z.object({ chargeId: z.string() }),
  // Порядок объявления обратный алфавитному: дескриптор обязан его выровнять
  errors: [QuotaExceeded, CardDeclined],
});

describe('describeContract', () => {
  it('описывает value-формы JSON Schema, когда конвертер передан', () => {
    const descriptor = describeContract(ChargeCard, {
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
    const descriptor = describeContract(ChargeCard);

    expect(descriptor.kind).toBe('request');
    expect(descriptor.input.kind).toBe('value');
    expect(descriptor.input.leaf).toEqual({ leaf: 'opaque', vendor: 'zod' });
    expect(descriptor.output.leaf).toEqual({ leaf: 'opaque', vendor: 'zod' });

    // Коды отказов от конвертера не зависят — они и есть структурная часть
    expect(descriptor.errors).toEqual([
      { code: 'CARD_DECLINED', status: 'PAYMENT_REQUIRED' },
      { code: 'QUOTA_EXCEEDED', status: 'TOO_MANY_REQUESTS' },
    ]);
  });

  it('аннотированный лист описан схемой даже без конвертеров', () => {
    const Annotated = makeContract({
      name: 'describe.annotated',
      kind: 'request',
      input: jsonSchema(z.object({ id: z.string() }), {
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
    });

    // Ни одного конвертера не передано: ответ на вопрос «как выглядит эта
    // схема» уже дан аннотацией, и терять его незачем
    expect(describeContract(Annotated).input.leaf).toEqual({
      leaf: 'schema',
      vendor: 'zod',
      jsonSchema: { properties: { id: { type: 'string' } }, type: 'object' },
    });
  });

  it('различает «листа нет» и «лист непрозрачен»', () => {
    const Ping = makeContract({ name: 'describe.ping', kind: 'command' });

    expect(describeContract(Ping).input.leaf).toEqual({ leaf: 'none' });
    expect(describeContract(ChargeCard).input.leaf).toEqual({
      leaf: 'opaque',
      vendor: 'zod',
    });
  });

  it('несёт вид потоковой формы выхода', () => {
    const Tail = makeContract({
      name: 'describe.logs.tail',
      kind: 'request',
      output: stream(z.object({ line: z.string() })),
    });

    const descriptor = describeContract(Tail, {
      converters: [zodConverter()],
    });

    expect(descriptor.output.kind).toBe('stream');
    expect(descriptor.output.leaf).toMatchObject({ leaf: 'schema' });
  });

  it('несёт примитивный лист и вид `events`', () => {
    const Feed = makeContract({
      name: 'describe.feed',
      kind: 'request',
      output: events('text'),
    });

    expect(describeContract(Feed).output).toEqual({
      kind: 'events',
      leaf: { leaf: 'primitive', primitive: 'text' },
    });
  });

  it('раскладывает multipart на поля и файлы с ограничениями', () => {
    const Upload = makeContract({
      name: 'describe.upload',
      kind: 'request',
      input: multipart({
        fields: z.object({ title: z.string() }),
        files: {
          avatar: upload({ maxSize: 1024, mime: ['image/png', 'image/gif'] }),
          attachments: upload({ multiple: true }),
        },
      }),
    });

    const descriptor = describeContract(Upload, {
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

  it('описывает декларацию-реализацию так же, как её контракт', () => {
    const Impl = implement(ChargeCard, {
      handle: async () => new Ok({ chargeId: '1' }),
    });

    expect(describeContract(Impl, { converters: [zodConverter()] })).toEqual(
      describeContract(ChargeCard, { converters: [zodConverter()] }),
    );
  });

  it('переживает сериализацию в JSON без потерь', () => {
    const descriptor = describeContract(ChargeCard, {
      converters: [zodConverter()],
    });

    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  it('чужое значение отвергает с указанием ожидаемого', () => {
    expect(() => describeContract({ pattern: 'GET /x' } as never)).toThrow(
      /makeContract\(\)|implement\(\)/,
    );
  });

  it('дубль вендора в списке конвертеров бросает', () => {
    expect(() =>
      describeContract(ChargeCard, {
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
