/**
 * Правила маппинга: адрес, параметры, тело, media types, ответы.
 *
 * Каждый случай проверяется на **построении из деклараций** — без
 * контейнера и без поднятого приложения: если для проверки документа
 * нужно приложение, значит документ выводится не только из деклараций.
 * Наружу эту функцию пакет отдаёт методом плагина; здесь она зовётся
 * напрямую, потому что предмет проверки — правила маппинга, а не подача.
 */

import { buildDocument } from './document.js';
import type { DocumentedEndpoint, OpenApiDocument } from './types.js';

import { describe, expect, it } from '@jest/globals';
import type { AnyEndpointDefinition } from '@nestlingjs/app';
import {
  events,
  jsonSchema,
  makeApp,
  makeFail,
  makeFeature,
  makePipeline,
  makePlugin,
  multipart,
  none,
  Ok,
  outputs,
  stream,
  upload,
} from '@nestlingjs/app';
import { makeSwitch } from '@nestlingjs/container';
import type { StandardSchemaV1 } from '@nestlingjs/operations';
import { body, makeRequest, query } from '@nestlingjs/operations';
import { zodConverter } from '@nestlingjs/schema.zod';
import { cliEndpoint } from '@nestlingjs/transport.cli';
import {
  http,
  httpEndpoint,
  HttpResponse,
  problemTypeOf,
} from '@nestlingjs/transport.http';
import { z } from 'zod';

const info = { title: 'Test API', version: '1.0.0' };

/** Строит документ из деклараций одной строкой: имя модуля здесь не важно */
const documentOf = (
  endpoints: readonly AnyEndpointDefinition[],
  options: { converters?: ReturnType<typeof zodConverter>[] } = {},
): OpenApiDocument =>
  buildDocument(
    endpoints.map((endpoint) => ({ endpoint, moduleName: 'module:test' })),
    { info, converters: options.converters ?? [zodConverter()] },
  );

const User = z.object({ id: z.string(), email: z.string() });

describe('документ строится из деклараций', () => {
  it("несёт версию спеки, переданный info и операции всех HTTP-endpoint'ов", () => {
    const List = httpEndpoint.get('/users', {
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const document = documentOf([List]);

    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toEqual(info);
    expect(Object.keys(document.paths)).toEqual(['/users']);
    expect(Object.keys(document.paths['/users'])).toEqual(['get']);
  });

  it('декларации прочих транспортов молча исключаются', () => {
    const Http = httpEndpoint.get('/users', {
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const Cli = cliEndpoint('seed-users', {
      output: z.unknown(),
      handler: async () => new Ok({ seeded: 0 }),
    });

    expect(Object.keys(documentOf([Http, Cli]).paths)).toEqual(['/users']);
  });

  it('переносит servers, security, securitySchemes и externalDocs как есть', () => {
    const document = buildDocument([], {
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
    expect(() => buildDocument([], { info: { title: 'x' } as never })).toThrow(
      /'info' must carry a 'title' and a 'version'/,
    );
  });
});

describe('адрес операции и её параметры', () => {
  it('path-параметр становится параметром пути, тела нет', () => {
    const Get = httpEndpoint.get('/users/:id', {
      input: z.object({ id: z.string() }),
      output: User,
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
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
    const Create = httpEndpoint.post('/users', {
      input: z.object({
        name: z.string(),
        dryRun: z.stringbool().optional(),
      }),
      bind: { dryRun: query() },
      output: User,
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const operation = documentOf([Create]).paths['/users'].post;

    expect(operation.parameters).toEqual([
      {
        name: 'dryRun',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        schema: { type: 'boolean' },
      },
    ]);

    const body = operation.requestBody?.content['application/json']
      .schema as Record<string, unknown>;

    expect(body.properties).toEqual({ name: { type: 'string' } });
    expect(body.required).toEqual(['name']);
  });

  it('path-параметр с разбором в число несёт тип разобранной формы', () => {
    const Page = httpEndpoint.get('/pages/:page', {
      input: z.object({
        page: z.string().pipe(z.coerce.number<string>().int().min(1).max(100)),
      }),
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const operation = documentOf([Page]).paths['/pages/{page}'].get;

    expect(operation.parameters).toEqual([
      {
        name: 'page',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1, maximum: 100 },
      },
    ]);
  });

  it('совпадающие формы параметр не меняют', () => {
    const Search = httpEndpoint.get('/users/search', {
      input: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const operation = documentOf([Search]).paths['/users/search'].get;

    expect(operation.parameters?.map((p) => [p.name, p.schema])).toEqual([
      ['q', { type: 'string' }],
      ['limit', { type: 'number' }],
    ]);
  });

  it('преобразование в схеме оставляет параметры входной формой', () => {
    const List = httpEndpoint.get('/users', {
      input: z.object({
        dryRun: z.stringbool().optional(),
        tags: z.string().transform((value) => value.split(',')),
      }),
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const operation = documentOf([List]).paths['/users'].get;

    expect(operation.parameters?.map((p) => [p.name, p.schema])).toEqual([
      ['dryRun', { type: 'string' }],
      ['tags', { type: 'string' }],
    ]);
  });

  it('поле, помеченное телом, остаётся в теле входной формой', () => {
    const Create = httpEndpoint.post('/users', {
      input: z.object({ dryRun: z.stringbool() }),
      bind: { dryRun: body() },
      output: User,
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const operation = documentOf([Create]).paths['/users'].post;

    expect(operation.parameters).toBeUndefined();
    expect(
      operation.requestBody?.content['application/json'].schema,
    ).toMatchObject({ properties: { dryRun: { type: 'string' } } });
  });

  it('выбранное свойство приносит описание и умолчание разобранной формы', () => {
    const List = httpEndpoint.get('/users', {
      input: z.object({
        dryRun: z.stringbool().default(true).describe('пробный прогон'),
      }),
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const [dryRun] = documentOf([List]).paths['/users'].get.parameters ?? [];

    expect(dryRun.schema).toEqual({
      description: 'пробный прогон',
      default: true,
      type: 'boolean',
    });
  });

  it('метод без тела раскладывает весь вход в query', () => {
    const Search = httpEndpoint.get('/users/search', {
      input: z.object({ q: z.string(), limit: z.coerce.number().optional() }),
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const operation = documentOf([Search]).paths['/users/search'].get;

    expect(operation.parameters?.map((p) => [p.name, p.required])).toEqual([
      ['q', true],
      ['limit', false],
    ]);
    expect(operation.requestBody).toBeUndefined();
  });

  it('пометка multiple даёт схему-массив', () => {
    const List = httpEndpoint.get('/users', {
      input: z.object({ tags: z.array(z.string()).optional() }),
      bind: { tags: query({ multiple: true }) },
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const [tags] = documentOf([List]).paths['/users'].get.parameters ?? [];

    expect(tags.schema).toMatchObject({ type: 'array' });
    expect(tags.style).toBe('form');
    expect(tags.explode).toBe(true);
  });

  it("дубль адреса — ошибка, называющая оба endpoint'а и их модули", () => {
    const first = httpEndpoint.post('/users', {
      output: z.unknown(),
      handler: async () => new Ok({}),
    });
    const second = httpEndpoint.post('/users', {
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() =>
      buildDocument(
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

    const declaration = httpEndpoint.implement(CreateUser, {
      handler: async ({ email }) => new Ok({ id: '1', email }),
    });

    expect(
      documentOf([declaration]).paths['/operation-users'].post.operationId,
    ).toBe('openapi.users.create');
  });

  it('без операции — детерминированный слаг от метода и пути', () => {
    const Get = httpEndpoint.get('/api/users/:id', {
      input: z.object({ id: z.string() }),
      output: User,
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(documentOf([Get]).paths['/api/users/{id}'].get.operationId).toBe(
      'get_api_users_id',
    );
  });
});

describe('media types выводятся из форм io', () => {
  it('потоковый выход описан элементом', () => {
    const Export = httpEndpoint.get('/users/export', {
      output: stream(User),
      handler: async function* () {
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
    const Activity = httpEndpoint.get('/users/activity', {
      output: events(z.object({ kind: z.string() })),
      handler: async function* () {
        yield { kind: 'created' };
      } as never,
    });

    const success = documentOf([Activity]).paths['/users/activity'].get
      .responses['200'];

    expect(Object.keys(success.content ?? {})).toEqual(['text/event-stream']);
    expect(success.description).toContain('"kind"');
  });

  it('multipart описан полями и файлами', () => {
    const Upload = httpEndpoint.post('/users/:id/avatar', {
      input: multipart({
        fields: z.object({ id: z.string(), title: z.string() }),
        files: { avatar: upload({ mime: ['image/png'] }) },
      }),
      output: z.object({ ok: z.boolean() }),
      handler: async () => new Ok({ ok: true }),
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
    const Upload = httpEndpoint.post('/users/photos', {
      input: multipart({ files: { photos: upload({ multiple: true }) } }),
      output: z.unknown(),
      handler: async () => new Ok({ ok: true }),
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
    const Hook = httpEndpoint.post('/hooks/stripe', {
      input: z.object({ id: z.string() }),
      rawBody: true,
      output: z.unknown(),
      handler: async () => new Ok({ received: true }),
    });

    expect(
      Object.keys(
        documentOf([Hook]).paths['/hooks/stripe'].post.requestBody?.content ??
          {},
      ),
    ).toEqual(['application/json']);
  });
});

const EmailTaken = makeFail('conflict:openapi_email_taken', {
  message: 'Email already taken',
  details: z.object({ email: z.string() }),
});

const TooLong = makeFail('bad_request:openapi_too_long', {
  message: 'Too long',
});

const TooShort = makeFail('bad_request:openapi_too_short', {
  message: 'Too short',
});

const Unauthorized = makeFail('unauthorized', { message: 'No token' });

describe('responses покрывают все ответы границы', () => {
  it('объявленный отказ становится ответом своего кода', () => {
    const Create = httpEndpoint.post('/users', {
      input: z.object({ email: z.string() }),
      output: User,
      errors: [EmailTaken],
      status: 'created',
      handler: async () => Ok.created({ id: '1', email: 'a@b.c' }),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(Object.keys(responses).sort()).toEqual([
      '201',
      '400',
      '409',
      'default',
    ]);

    expect(Object.keys(responses['409'].content ?? {})).toEqual([
      'application/problem+json',
    ]);
    expect(
      responses['409'].content?.['application/problem+json'].schema,
    ).toEqual({
      type: 'object',
      properties: {
        type: { const: 'urn:error:conflict:openapi_email_taken' },
        title: { const: 'Conflict' },
        status: { const: 409 },
        detail: { type: 'string' },
        details: expect.objectContaining({ type: 'object' }),
      },
      required: ['type', 'title', 'status', 'detail'],
    });
  });

  it('объявленный редирект становится ответом 3xx с Location', () => {
    const Login = httpEndpoint.post('/login', {
      input: z.object({ email: z.string() }),
      redirect: 303,
      output: z.unknown(),
      handler: async () => HttpResponse.redirect('/app'),
    });

    const responses = documentOf([Login]).paths['/login'].post.responses;

    // Редирект и есть успешный исход: ответа по `doc.status` в операции нет
    expect(Object.keys(responses).sort()).toEqual(['303', '400', 'default']);
    expect(responses['303'].content).toBeUndefined();
    expect(responses['303'].headers?.Location.schema).toEqual({
      type: 'string',
    });
  });

  it('endpoint без редиректа сохраняет состав ответов', () => {
    const Get = httpEndpoint.get('/users/:id', {
      input: z.object({ id: z.string() }),
      output: User,
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(
      Object.keys(documentOf([Get]).paths['/users/{id}'].get.responses).sort(),
    ).toEqual(['200', '400', 'default']);
  });

  it('отказ слоя становится ответом без errors: у декларации', () => {
    const authed = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });

    const Create = httpEndpoint.post('/users', {
      output: User,
      pipeline: authed,
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(Object.keys(responses).sort()).toEqual(['200', '401', 'default']);
    expect(
      responses['401'].content?.['application/problem+json'].schema,
    ).toEqual({
      type: 'object',
      properties: {
        type: { const: 'urn:error:unauthorized' },
        title: { const: 'Unauthorized' },
        status: { const: 401 },
        detail: { type: 'string' },
      },
      required: ['type', 'title', 'status', 'detail'],
    });
  });

  it('отказ, объявленный и слоем, и декларацией, даёт один ответ', () => {
    const authed = makePipeline().pre(() => Unauthorized(), {
      errors: [Unauthorized],
    });

    const Create = httpEndpoint.post('/users', {
      output: User,
      errors: [Unauthorized],
      pipeline: authed,
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const schema = documentOf([Create]).paths['/users'].post.responses['401']
      .content?.['application/problem+json'].schema as { oneOf?: unknown[] };

    expect(schema.oneOf).toBeUndefined();
  });

  it('два отказа на одном коде сводятся в oneOf, различимый по type', () => {
    const Create = httpEndpoint.post('/users', {
      output: User,
      errors: [TooLong, TooShort],
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const schema = documentOf([Create]).paths['/users'].post.responses['400']
      .content?.['application/problem+json'].schema as {
      oneOf: { properties: { type: { const: string } } }[];
    };

    expect(schema.oneOf).toHaveLength(2);
    expect(schema.oneOf.map((branch) => branch.properties.type.const)).toEqual([
      problemTypeOf(TooLong.code),
      problemTypeOf(TooShort.code),
    ]);
  });

  it('валидация и неизвестный отказ описаны всегда', () => {
    const Create = httpEndpoint.post('/users', {
      input: z.object({ email: z.string() }),
      output: User,
      handler: async () => new Ok({ id: '1', email: 'a@b.c' }),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(
      (
        responses['400'].content?.['application/problem+json'].schema as {
          properties: { type: { const: string } };
        }
      ).properties.type.const,
    ).toBe('urn:error:bad_request');

    expect(
      (
        responses.default.content?.['application/problem+json'].schema as {
          properties: { type: { const: string } };
        }
      ).properties.type.const,
    ).toBe('urn:error:internal_error');
  });

  it('endpoint без выхода отвечает 204 без тела', () => {
    const Remove = httpEndpoint.delete('/users/:id', {
      input: z.object({ id: z.string() }),
      handler: async () => Ok.noContent(),
    });

    const responses = documentOf([Remove]).paths['/users/{id}'].delete
      .responses;

    expect(responses['204']).toEqual({ description: 'Success' });
  });

  it('endpoint со схемой выхода без поля `status` отвечает 200', () => {
    const List = httpEndpoint.get('/users', {
      output: z.array(User),
      handler: async () => new Ok([]),
    });

    const responses = documentOf([List]).paths['/users'].get.responses;

    expect(Object.keys(responses)).toContain('200');
    expect(responses['200'].content).toHaveProperty('application/json');
  });

  it('исходы развилки описаны каждый своей схемой', () => {
    const Job = z.object({ jobId: z.string() });

    const Create = httpEndpoint.post('/jobs', {
      output: outputs({ ok: User, accepted: Job }),
      handler: async () => Ok.accepted({ jobId: 'j-1' }),
    });

    const responses = documentOf([Create]).paths['/jobs'].post.responses;

    expect(responses['200'].content?.['application/json'].schema).toMatchObject(
      { properties: { email: { type: 'string' } } },
    );
    expect(responses['202'].content?.['application/json'].schema).toMatchObject(
      { properties: { jobId: { type: 'string' } } },
    );
  });

  it('ветка `none()` печатается без тела', () => {
    const Create = httpEndpoint.post('/users', {
      output: outputs({ created: User, no_content: none() }),
      handler: async () => Ok.noContent(),
    });

    const responses = documentOf([Create]).paths['/users'].post.responses;

    expect(responses['201'].content).toHaveProperty('application/json');
    expect(responses['204']).toEqual({ description: 'Success' });
  });

  it('ветка с примитивом получает свой media type', () => {
    const Create = httpEndpoint.post('/reports', {
      output: outputs({ ok: User, accepted: 'text' }),
      handler: async () => Ok.accepted('queued'),
    });

    const responses = documentOf([Create]).paths['/reports'].post.responses;

    expect(responses['200'].content).toHaveProperty('application/json');
    expect(responses['202'].content).toHaveProperty('text/plain');
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
    const Create = httpEndpoint.post('/users', {
      input: exotic<{ id: string }>('valibot'),
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() => documentOf([Create])).toThrow(
      /'POST \/users'.*'input'.*'valibot'.*converters.*jsonSchema\(schema/s,
    );
  });

  it('аннотация снимает требование конвертера', () => {
    const Create = httpEndpoint.post('/users', {
      input: jsonSchema(exotic<{ id: string }>('valibot'), {
        type: 'object',
        properties: { id: { type: 'string' } },
      }),
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(
      documentOf([Create], { converters: [] }).paths['/users'].post.requestBody
        ?.content['application/json'].schema,
    ).toMatchObject({ properties: { id: { type: 'string' } } });
  });

  it('path-параметр без свойства в схеме — ошибка', () => {
    const Get = httpEndpoint.get('/users/:id', {
      input: z.object({ userId: z.string() }),
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() => documentOf([Get])).toThrow(
      /path parameter ':id' has no matching property/,
    );
  });

  it('bind-пометка на несуществующем поле — ошибка', () => {
    const List = httpEndpoint.get('/users', {
      input: z.object({ id: z.string() }),
      bind: { missing: query() } as never,
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() => documentOf([List])).toThrow(
      /field 'missing' is marked in 'bind'/,
    );
  });

  it('нарушения перечисляются вместе, а не по одному', () => {
    const first = httpEndpoint.post('/a', {
      input: exotic<{ id: string }>('valibot'),
      output: z.unknown(),
      handler: async () => new Ok({}),
    });
    const second = httpEndpoint.post('/b', {
      input: exotic<{ id: string }>('valibot'),
      output: z.unknown(),
      handler: async () => new Ok({}),
    });
    const third = httpEndpoint.post('/c', {
      output: exotic<{ id: string }>('valibot'),
      handler: async () => new Ok({ id: '1' }),
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
    const Exotic = makeFail('conflict:openapi_exotic', {
      message: 'Exotic',
      details: exotic<{ id: string }>('valibot'),
    });

    const Create = httpEndpoint.post('/users', {
      errors: [Exotic],
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() => documentOf([Create])).toThrow(
      /errors\['conflict:openapi_exotic']\.details/,
    );
  });
});

describe('скрытый endpoint', () => {
  const Health = httpEndpoint.get('/health', {
    output: z.object({ status: z.string() }),
    doc: { hidden: 'liveness-проба балансировщика' },
    handler: async () => new Ok({ status: 'up' }),
  });

  it('не попадает в paths', () => {
    expect(documentOf([Health]).paths['/health']).toBeUndefined();
  });

  it('её схемы не проверяются на конвертируемость', () => {
    const Hidden = httpEndpoint.get('/internal', {
      input: exotic<{ id: string }>('arktype'),
      doc: { hidden: 'внутренняя ручка' },
      output: z.unknown(),
      handler: async () => new Ok({}),
    });

    expect(() => documentOf([Hidden], { converters: [] })).not.toThrow();
  });
});

describe('конвертер, отказавшийся переводить схему', () => {
  it("даёт диагностику с координатами endpoint'а, а не голый бросок", () => {
    // `z.date()` на выходе непредставим в JSON Schema: zod бросает, и без
    // ветки-перехватчика автор увидел бы ошибку без имени endpoint'а и слота
    const Report = httpEndpoint.get('/report', {
      output: z.object({ generatedAt: z.date() }),
      handler: async () => new Ok({ generatedAt: new Date(0) }),
    });

    expect(() => documentOf([Report])).toThrow(
      /'GET \/report'.*'output' schema could not be converted.*jsonSchema\(schema/s,
    );
  });
});

describe('вход генератора — декларация приложения', () => {
  const ListUsers = httpEndpoint.get('/users', {
    output: z.array(User),
    handler: async () => new Ok([]),
  });

  const ListInvoices = httpEndpoint.get('/invoices', {
    output: z.array(z.object({ id: z.string() })),
    handler: async () => new Ok([]),
  });

  const OpenApiJson = httpEndpoint.get('/openapi.json', {
    output: z.object({ openapi: z.string() }),
    handler: async () => new Ok({ openapi: '3.1.0' }),
  });

  const Docs = makeSwitch('docs', { default: 'on' });

  const app = makeApp({
    features: [
      makeFeature({ name: 'users', endpoints: [ListUsers] }),
      makeFeature({ name: 'billing', endpoints: [ListInvoices] }),
    ],
    plugins: [
      Docs.when(makePlugin({ name: 'docs', endpoints: [OpenApiJson] })),
    ],
    switches: [Docs],
    transports: [http()],
  });

  const documentFor = (args?: Parameters<typeof app.discover>[0]) =>
    buildDocument(app.discover(args).endpoints, {
      info,
      converters: [zodConverter()],
    });

  it('без поднятия приложения: все объявленные фичи и плагины', () => {
    const document = documentFor();

    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths).sort()).toEqual([
      '/invoices',
      '/openapi.json',
      '/users',
    ]);
  });

  it('аргумент сборки меняет состав paths', () => {
    const document = documentFor({ features: 'users' });

    expect(Object.keys(document.paths).sort()).toEqual([
      '/openapi.json',
      '/users',
    ]);
  });

  it('невыбранная ветка переключателя в документ не попадает', () => {
    const document = documentFor({ features: 'users', docs: 'off' });

    expect(Object.keys(document.paths)).toEqual(['/users']);
  });
});
