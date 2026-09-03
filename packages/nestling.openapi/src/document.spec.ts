/**
 * Правила маппинга: адрес, параметры, тело, media types, ответы.
 *
 * Каждый случай проверяется на **чистой функции** — без контейнера и без
 * поднятого приложения: если для проверки документа нужно приложение,
 * значит документ выводится не только из деклараций.
 */

import { buildOpenApiDocument } from './document.js';
import type { DocumentedEndpoint, OpenApiDocument } from './types.js';

import { describe, expect, it } from '@jest/globals';
import { zodConverter } from '@nestling/openapi.zod';
import type { StandardSchemaV1 } from '@nestling/operations';
import { makeRequest, query } from '@nestling/operations';
import type { AnyEndpointDefinition } from '@nestling/pipeline';
import {
  defineFail,
  events,
  jsonSchema,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/pipeline';
import { cliEndpoint } from '@nestling/transport.cli';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const info = { title: 'Test API', version: '1.0.0' };

/** Строит документ из деклараций одной строкой: имя модуля здесь не важно */
const documentOf = (
  endpoints: readonly AnyEndpointDefinition[],
  options: { converters?: ReturnType<typeof zodConverter>[] } = {},
): OpenApiDocument =>
  buildOpenApiDocument(
    endpoints.map((endpoint) => ({ endpoint, moduleName: 'module:test' })),
    { info, converters: options.converters ?? [zodConverter()] },
  );

const User = z.object({ id: z.string(), email: z.string() });

describe('документ строится из деклараций', () => {
  it("несёт версию спеки, переданный info и операции всех HTTP-endpoint'ов", () => {
    const List = httpEndpoint({
      method: 'GET',
      path: '/users',
      output: z.array(User),
      handle: async () => new Ok([]),
    });

    const document = documentOf([List]);

    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual(info);
    expect(Object.keys(document.paths)).toEqual(['/users']);
    expect(Object.keys(document.paths['/users'])).toEqual(['get']);
  });

  it('декларации прочих транспортов молча исключаются', () => {
    const Http = httpEndpoint({
      method: 'GET',
      path: '/users',
      output: z.array(User),
      handle: async () => new Ok([]),
    });

    const Cli = cliEndpoint({
      command: 'seed-users',
      handle: async () => new Ok({ seeded: 0 }),
    });

    expect(Object.keys(documentOf([Http, Cli]).paths)).toEqual(['/users']);
  });

  it('переносит servers, security, securitySchemes и externalDocs как есть', () => {
    const document = buildOpenApiDocument([], {
      info,
      servers: [{ url: 'https://api.example.com' }],
      security: [{ bearer: [] }],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      externalDocs: { url: 'https://example.com/docs' },
    });

    expect(document.servers).toEqual([{ url: 'https://api.example.com' }]);
    expect(document.security).toEqual([{ bearer: [] }]);
    expect(document.components?.securitySchemes).toEqual({
      bearer: { type: 'http', scheme: 'bearer' },
    });
    expect(document.externalDocs).toEqual({ url: 'https://example.com/docs' });
  });

  it('info без title или version отвергается', () => {
    expect(() =>
      buildOpenApiDocument([], { info: { title: 'x' } as never }),
    ).toThrow(/'info' must carry a 'title' and a 'version'/);
  });
});

describe('адрес операции и её параметры', () => {
  it('path-параметр становится параметром пути, тела нет', () => {
    const Get = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      output: User,
      handle: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    const operation = documentOf([Get]).paths['/users/{id}'].get;

    expect(operation.parameters).toEqual([
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    ]);
    expect(operation.requestBody).toBeUndefined();
  });

  it('помеченное поле уходит из тела в query', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      input: z.object({
        name: z.string(),
        dryRun: z.stringbool().optional(),
      }),
      bind: { dryRun: query() },
      output: User,
      handle: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const operation = documentOf([Create]).paths['/users'].post;

    expect(operation.parameters).toEqual([
      {
        name: 'dryRun',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        schema: expect.anything(),
      },
    ]);

    const body = operation.requestBody?.content['application/json']
      .schema as Record<string, unknown>;

    expect(Object.keys(body.properties as object)).toEqual(['name']);
    expect(body.required).toEqual(['name']);
  });

  it('метод без тела раскладывает весь вход в query', () => {
    const Search = httpEndpoint({
      method: 'GET',
      path: '/users/search',
      input: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      output: z.array(User),
      handle: async () => new Ok([]),
    });

    const operation = documentOf([Search]).paths['/users/search'].get;

    expect(operation.parameters?.map((p) => [p.name, p.required])).toEqual([
      ['q', true],
      ['limit', false],
    ]);
    expect(operation.requestBody).toBeUndefined();
  });

  it('пометка multiple даёт схему-массив', () => {
    const List = httpEndpoint({
      method: 'GET',
      path: '/users',
      input: z.object({ tags: z.array(z.string()).optional() }),
      bind: { tags: query({ multiple: true }) },
      output: z.array(User),
      handle: async () => new Ok([]),
    });

    const [tags] = documentOf([List]).paths['/users'].get.parameters ?? [];

    expect(tags.schema).toMatchObject({ type: 'array' });
    expect(tags.style).toBe('form');
    expect(tags.explode).toBe(true);
  });

  it("дубль адреса — ошибка, называющая оба endpoint'а и их модули", () => {
    const first = httpEndpoint({
      method: 'POST',
      path: '/users',
      handle: async () => new Ok({}),
    });
    const second = httpEndpoint({
      method: 'POST',
      path: '/users',
      handle: async () => new Ok({}),
    });

    expect(() =>
      buildOpenApiDocument(
        [
          { endpoint: first, moduleName: 'module:a' },
          { endpoint: second, moduleName: 'module:b' },
        ] as DocumentedEndpoint[],
        { info },
      ),
    ).toThrow(/module 'module:a'.*module 'module:b'/s);
  });
});

describe('operationId выводится, а не объявляется', () => {
  it('берётся с операции', () => {
    const CreateUser = makeRequest({
      name: 'openapi.users.create',
      http: 'POST /operation-users',
      input: z.object({ email: z.string() }),
      output: User,
    });

    const declaration = httpEndpoint({
      operation: CreateUser,
      handle: async ({ email }) => new Ok({ id: '1', email }),
    });

    expect(
      documentOf([declaration]).paths['/operation-users'].post.operationId,
    ).toBe('openapi.users.create');
  });

  it('без операции — детерминированный слаг от метода и пути', () => {
    const Get = httpEndpoint({
      method: 'GET',
      path: '/api/users/:id',
      input: z.object({ id: z.string() }),
      output: User,
      handle: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(documentOf([Get]).paths['/api/users/{id}'].get.operationId).toBe(
      'get_api_users_id',
    );
  });
});

describe('media types выводятся из форм io', () => {
  it('потоковый выход описан элементом', () => {
    const Export = httpEndpoint({
      method: 'GET',
      path: '/users/export',
      output: stream(User),
      handle: async function* () {
        yield { id: '1', email: 'a@b.c' };
      } as never,
    });

    const success = documentOf([Export]).paths['/users/export'].get.responses[
      '200'
    ];

    expect(Object.keys(success.content ?? {})).toEqual([
      'application/x-ndjson',
    ]);
    expect(success.content?.['application/x-ndjson'].schema).toMatchObject({
      properties: { id: { type: 'string' } },
    });
  });

  it('SSE-выход описан text/event-stream, схема элемента — в описании', () => {
    const Activity = httpEndpoint({
      method: 'GET',
      path: '/users/activity',
      output: events(z.object({ kind: z.string() })),
      handle: async function* () {
        yield { kind: 'created' };
      } as never,
    });

    const success = documentOf([Activity]).paths['/users/activity'].get
      .responses['200'];

    expect(Object.keys(success.content ?? {})).toEqual(['text/event-stream']);
    expect(success.description).toContain('"kind"');
  });

  it('multipart описан полями и файлами', () => {
    const Upload = httpEndpoint({
      method: 'POST',
      path: '/users/:id/avatar',
      input: multipart({
        fields: z.object({ id: z.string(), title: z.string() }),
        files: { avatar: upload({ mime: ['image/png'] }) },
      }),
      output: z.object({ ok: z.boolean() }),
      handle: async () => new Ok({ ok: true }),
    });

    const operation = documentOf([Upload]).paths['/users/{id}/avatar'].post;
    const schema = operation.requestBody?.content['multipart/form-data']
      .schema as Record<string, Record<string, unknown>>;

    // Path-параметр вынесен из полей формы в параметры пути
    expect(operation.parameters?.map((p) => p.name)).toEqual(['id']);
    expect(Object.keys(schema.properties)).toEqual(['title', 'avatar']);
    expect(schema.properties.avatar).toEqual({
      type: 'string',
      format: 'binary',
      contentMediaType: 'image/png',
    });
  });

  it('multiple-файл даёт массив', () => {
    const Upload = httpEndpoint({
      method: 'POST',
      path: '/users/photos',
      input: multipart({ files: { photos: upload({ multiple: true }) } }),
      handle: async () => new Ok({ ok: true }),
    });

    const schema = documentOf([Upload]).paths['/users/photos'].post.requestBody
      ?.content['multipart/form-data'].schema as Record<
      string,
      Record<string, unknown>
    >;

    expect(schema.properties.photos).toEqual({
      type: 'array',
      items: { type: 'string', format: 'binary' },
    });
  });

  it('rawBody на media type не влияет', () => {
    const Hook = httpEndpoint({
      method: 'POST',
      path: '/hooks/stripe',
      input: z.object({ id: z.string() }),
      rawBody: true,
      handle: async () => new Ok({ received: true }),
    });

    expect(
      Object.keys(
        documentOf([Hook]).paths['/hooks/stripe'].post.requestBody?.content ??
          {},
      ),
    ).toEqual(['application/json']);
  });
});

const EmailTaken = defineFail('OPENAPI_EMAIL_TAKEN', {
  status: 'CONFLICT',
  message: 'Email already taken',
  details: z.object({ email: z.string() }),
});

const TooLong = defineFail('OPENAPI_TOO_LONG', {
  status: 'BAD_REQUEST',
  message: 'Too long',
});

const TooShort = defineFail('OPENAPI_TOO_SHORT', {
  status: 'BAD_REQUEST',
  message: 'Too short',
});

describe('responses покрывают все ответы границы', () => {
  it('объявленный отказ становится ответом своего кода', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      input: z.object({ email: z.string() }),
      output: User,
      errors: [EmailTaken],
      doc: { status: 'CREATED' },
      handle: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(Object.keys(responses).sort()).toEqual([
      '201',
      '400',
      '409',
      'default',
    ]);

    expect(responses['409'].content?.['application/json'].schema).toEqual({
      type: 'object',
      properties: {
        error: { type: 'string' },
        code: { const: 'OPENAPI_EMAIL_TAKEN' },
        details: expect.objectContaining({ type: 'object' }),
      },
      required: ['error', 'code'],
    });
  });

  it('два отказа на одном коде сводятся в oneOf', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      output: User,
      errors: [TooLong, TooShort],
      handle: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const schema = documentOf([Create]).paths['/users'].post.responses['400']
      .content?.['application/json'].schema as { oneOf: unknown[] };

    expect(schema.oneOf).toHaveLength(2);
  });

  it('валидация и неизвестный отказ описаны всегда', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      input: z.object({ email: z.string() }),
      output: User,
      handle: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(
      (
        responses['400'].content?.['application/json'].schema as {
          properties: { code: { const: string } };
        }
      ).properties.code.const,
    ).toBe('VALIDATION_FAILED');

    expect(
      (
        responses.default.content?.['application/json'].schema as {
          properties: { code: { const: string } };
        }
      ).properties.code.const,
    ).toBe('UNKNOWN');
  });

  it('endpoint без выхода отвечает 204 без тела', () => {
    const Remove = httpEndpoint({
      method: 'DELETE',
      path: '/users/:id',
      input: z.object({ id: z.string() }),
      handle: async () => new Ok(null),
    });

    const responses = documentOf([Remove]).paths['/users/{id}'].delete
      .responses;

    expect(responses['204']).toEqual({ description: 'Success' });
  });
});

/**
 * Схема вендора, конвертера для которого нет ни у кого.
 *
 * Написана руками, потому что Standard Schema это интерфейс: чтобы
 * проверить «нет конвертера», второй валидатор в devDependencies не нужен.
 */
const exotic = <T>(vendor: string): StandardSchemaV1<unknown, T> => ({
  '~standard': {
    version: 1,
    vendor,
    validate: (value: unknown) => ({ value: value as T }),
  },
});

describe('недокументируемая схема роняет построение', () => {
  it('нет конвертера — ошибка называет endpoint, слот, вендор и оба способа починки', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      input: exotic<{ id: string }>('valibot'),
      handle: async () => new Ok({}),
    });

    expect(() => documentOf([Create])).toThrow(
      /'POST \/users'.*'input'.*'valibot'.*converters.*jsonSchema\(schema/s,
    );
  });

  it('аннотация снимает требование конвертера', () => {
    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      input: jsonSchema(exotic<{ id: string }>('valibot'), {
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
      handle: async () => new Ok({}),
    });

    expect(
      documentOf([Create], { converters: [] }).paths['/users'].post.requestBody
        ?.content['application/json'].schema,
    ).toMatchObject({ properties: { id: { type: 'string' } } });
  });

  it('path-параметр без свойства в схеме — ошибка', () => {
    const Get = httpEndpoint({
      method: 'GET',
      path: '/users/:id',
      input: z.object({ userId: z.string() }),
      handle: async () => new Ok({}),
    });

    expect(() => documentOf([Get])).toThrow(
      /path parameter ':id' has no matching property/,
    );
  });

  it('bind-пометка на несуществующем поле — ошибка', () => {
    const List = httpEndpoint({
      method: 'GET',
      path: '/users',
      input: z.object({ id: z.string() }),
      bind: { missing: query() } as never,
      handle: async () => new Ok({}),
    });

    expect(() => documentOf([List])).toThrow(
      /field 'missing' is marked in 'bind'/,
    );
  });

  it('нарушения перечисляются вместе, а не по одному', () => {
    const first = httpEndpoint({
      method: 'POST',
      path: '/a',
      input: exotic<{ id: string }>('valibot'),
      handle: async () => new Ok({}),
    });
    const second = httpEndpoint({
      method: 'POST',
      path: '/b',
      input: exotic<{ id: string }>('valibot'),
      handle: async () => new Ok({}),
    });
    const third = httpEndpoint({
      method: 'POST',
      path: '/c',
      output: exotic<{ id: string }>('valibot'),
      handle: async () => new Ok({ id: '1' }),
    });

    let message = '';
    try {
      documentOf([first, second, third]);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("'POST /a'");
    expect(message).toContain("'POST /b'");
    expect(message).toContain("'POST /c'");
    expect(message).toContain('3 endpoint(s) cannot be documented');
  });

  it('details отказа проверяются наравне с input и output', () => {
    const Exotic = defineFail('OPENAPI_EXOTIC', {
      status: 'CONFLICT',
      message: 'Exotic',
      details: exotic<{ id: string }>('valibot'),
    });

    const Create = httpEndpoint({
      method: 'POST',
      path: '/users',
      errors: [Exotic],
      handle: async () => new Ok({}),
    });

    expect(() => documentOf([Create])).toThrow(
      /errors\['OPENAPI_EXOTIC']\.details/,
    );
  });
});

describe('скрытый endpoint', () => {
  const Health = httpEndpoint({
    method: 'GET',
    path: '/health',
    output: z.object({ status: z.string() }),
    doc: { hidden: 'liveness-проба балансировщика' },
    handle: async () => new Ok({ status: 'up' }),
  });

  it('не попадает в paths', () => {
    expect(documentOf([Health]).paths['/health']).toBeUndefined();
  });

  it('её схемы не проверяются на конвертируемость', () => {
    const Hidden = httpEndpoint({
      method: 'GET',
      path: '/internal',
      input: exotic<{ id: string }>('arktype'),
      doc: { hidden: 'внутренняя ручка' },
      handle: async () => new Ok({}),
    });

    expect(() => documentOf([Hidden], { converters: [] })).not.toThrow();
  });
});

describe('конвертер, отказавшийся переводить схему', () => {
  it("даёт диагностику с координатами endpoint'а, а не голый бросок", () => {
    // `z.date()` на выходе непредставим в JSON Schema: zod бросает, и без
    // ветки-перехватчика автор увидел бы ошибку без имени endpoint'а и слота
    const Report = httpEndpoint({
      method: 'GET',
      path: '/report',
      output: z.object({ generatedAt: z.date() }),
      handle: async () => new Ok({ generatedAt: new Date(0) }),
    });

    expect(() => documentOf([Report])).toThrow(
      /'GET \/report'.*'output' schema could not be converted.*jsonSchema\(schema/s,
    );
  });
});
