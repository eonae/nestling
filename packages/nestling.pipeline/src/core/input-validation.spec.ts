/**
 * Проверка входа рантаймом: точка проверки, кандидат, поведение по формам
 * и исход отказа.
 *
 * Регрессия, ради которой change и делался: endpoint со схемой `input` и
 * пайплайном без юнита проверки принимал невалидный payload и отвечал
 * успехом.
 */

import type { EndpointMeta, ResponseContext } from './types/context.js';
import { makeEmptyContext } from './types/context.js';
import type { Raw } from './types/raw.js';
import type { PreUnitFn } from './types/unit.js';
import type { UnknownFailInfo } from './pipeline.js';
import { compose, makePipeline } from './pipeline.js';

import type { Schema, StandardSchemaV1 } from '@common/misc';
import type { AnyPayload } from '@nestling/operations';
import {
  defineFail,
  multipart,
  Ok,
  stream,
  upload,
} from '@nestling/operations';
import { z } from 'zod';

const Row = z.object({ id: z.string() });
type Row = z.infer<typeof Row>;

const raw = (payload?: unknown): Raw => ({
  transport: 'test',
  pattern: 'POST /things',
  payload,
  attributes: {},
});

/** Отказ авторизации: нужен объявленным, иначе граница заменит его на `UNKNOWN` */
const NoToken = defineFail('NO_TOKEN', {
  status: 'UNAUTHORIZED',
  message: 'No token',
});

const meta = (input?: AnyPayload): EndpointMeta => ({
  transport: 'test',
  pattern: 'POST /things',
  input,
  errors: [NoToken],
});

const ctxFor = (input: AnyPayload | undefined, payload: unknown) =>
  makeEmptyContext(raw(payload), meta(input));

/** Схема-заглушка: отдаёт то, что ей задали */
function fakeSchema<T>(
  validateFn: StandardSchemaV1.Props<unknown, T>['validate'],
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': { version: 1, vendor: 'test', validate: validateFn },
  };
}

/**
 * Исполнимый пайплайн без параметров типов.
 *
 * Тесты собирают слои из разных юнитов, и точные `TReq`/`TAcc` каждого не
 * относятся к проверяемому поведению.
 */
interface Runnable {
  executeWithHandler(
    handler: (payload: unknown, meta: Record<string, unknown>) => unknown,
    ctx: unknown,
    options?: unknown,
  ): Promise<ResponseContext>;
}

const runnable = (pipeline: unknown): Runnable => pipeline as Runnable;

/** Юнит, дополняющий контекст обычным полем */
const withRequestId: PreUnitFn<
  Record<string, never>,
  { rid: string }
> = async () => ({ rid: 'r-1' });

/** Юнит, распаковывающий конверт: подменяет кандидата проверки */
const unwrapEnvelope: PreUnitFn<
  Record<string, never>,
  { payload: unknown }
> = async (ctx) => ({
  payload: (ctx.raw.payload as { params: unknown }).params,
});

/** Тот же юнит плюс обычное поле: проверяет состав меты хендлера */
const unwrapWithField: PreUnitFn<
  Record<string, never>,
  { payload: unknown; rid: string }
> = async (ctx) => ({ payload: ctx.raw.payload, rid: 'r-1' });

/** Юнит авторизации, отвергающий запрос до проверки входа */
const deny: PreUnitFn<Record<string, never>, never> = async () => {
  throw NoToken();
};

/** Собирает ответ и то, что увидел хендлер */
async function run(
  pipeline: unknown,
  input: AnyPayload | undefined,
  payload?: unknown,
  options?: { onUnknownFail?: (info: UnknownFailInfo) => void },
): Promise<{ response: ResponseContext; seen: unknown; called: boolean }> {
  let seen: unknown;
  let called = false;

  const response = await runnable(pipeline).executeWithHandler(
    (value) => {
      called = true;
      seen = value;
      return new Ok({ ok: true });
    },
    ctxFor(input, payload),
    options ?? {},
  );

  return { response, seen, called };
}

describe('Проверка входа выполняется без юнита в пайплайне', () => {
  it('отвергает невалидный payload у пайплайна с обычными юнитами', async () => {
    const { response, called } = await run(
      makePipeline().pre(withRequestId),
      z.object({ n: z.number() }),
      { n: 'not-a-number' },
    );

    expect(called).toBe(false);
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'BAD_REQUEST',
      value: {
        code: 'VALIDATION_FAILED',
        details: [{ message: expect.any(String), path: ['n'] }],
      },
    });
  });

  it('отвергает невалидный payload у пустого пайплайна', async () => {
    const { response, called } = await run(makePipeline(), Row, { id: 42 });

    expect(called).toBe(false);
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'BAD_REQUEST',
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('отдаёт хендлеру выход схемы, а не исходное значение', async () => {
    const schema = z.object({
      id: z.string().transform((value: string) => Number.parseInt(value, 10)),
    });

    const { seen, response } = await run(makePipeline(), schema, { id: '42' });

    expect(seen).toEqual({ id: 42 });
    expect(response.isSuccess).toBe(true);
  });

  it('пропускает любое значение по схеме, принимающей всё', async () => {
    const { seen, response } = await run(makePipeline(), z.unknown(), {
      whatever: true,
    });

    expect(seen).toEqual({ whatever: true });
    expect(response.isSuccess).toBe(true);
  });
});

describe('Кандидат проверки', () => {
  it('берётся из контекста, если его положил `.pre`-юнит', async () => {
    const { seen, response } = await run(
      makePipeline().pre(unwrapEnvelope),
      Row,
      {
        method: 'things.create',
        params: { id: 'a' },
      },
    );

    expect(seen).toEqual({ id: 'a' });
    expect(response.isSuccess).toBe(true);
  });

  it('подменённый кандидат тоже проверяется схемой', async () => {
    const { response, called } = await run(
      makePipeline().pre(unwrapEnvelope),
      Row,
      {
        params: { id: 7 },
      },
    );

    expect(called).toBe(false);
    expect(response).toMatchObject({ value: { code: 'VALIDATION_FAILED' } });
  });

  it('ключ `payload` не попадает в мету хендлера', async () => {
    let handlerMeta: Record<string, unknown> = {};
    await runnable(makePipeline().pre(unwrapWithField)).executeWithHandler(
      (_payload, m) => {
        handlerMeta = m;
        return new Ok({ ok: true });
      },
      ctxFor(Row, { id: 'a' }),
    );

    expect(handlerMeta).not.toHaveProperty('payload');
    expect(handlerMeta.rid).toBe('r-1');
  });

  it('проверенное значение не попадает в контекст запроса', async () => {
    let inputKeys: string[] = [];

    await makePipeline()
      .finally((_outcome, _response, ctx) => {
        inputKeys = Object.keys(ctx.input);
      })
      .executeWithHandler(() => new Ok({ ok: true }), ctxFor(Row, { id: 'a' }));

    expect(inputKeys).not.toContain('payload');
  });
});

describe('Порядок: `.pre`-юниты раньше проверки', () => {
  it('отказ `.pre`-юнита отменяет проверку', async () => {
    let schemaCalled = false;
    const schema = fakeSchema(() => {
      schemaCalled = true;
      return { value: {} };
    });

    const { response } = await run(
      makePipeline().pre(deny),
      schema as unknown as Schema,
      {},
    );

    expect(schemaCalled).toBe(false);
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'UNAUTHORIZED',
    });
  });

  it('отказ проверки видят `.catch` и `.finally` обоих слоёв', async () => {
    const seen: string[] = [];
    const outer = makePipeline()
      .pre(async () => ({ rid: 'r-1' }))
      .catch(() => {
        seen.push('outer.catch');
      })
      .finally((outcome) => {
        seen.push(`outer.finally:${outcome}`);
      });
    const inner = makePipeline<{ rid: string }>()
      .pre(async () => ({}))
      .catch(() => {
        seen.push('inner.catch');
      })
      .finally(() => {
        seen.push('inner.finally');
      });

    const hookCalls: UnknownFailInfo[] = [];
    const { response } = await run(
      compose(outer, inner),
      Row,
      { id: 42 },
      { onUnknownFail: (info) => hookCalls.push(info) },
    );

    expect(seen).toEqual([
      'inner.catch',
      'outer.catch',
      'inner.finally',
      'outer.finally:failed',
    ]);
    expect(response).toMatchObject({ value: { code: 'VALIDATION_FAILED' } });
    expect(hookCalls).toHaveLength(0);
  });
});

describe('Формы, у которых проверять нечего', () => {
  it('без `input` хендлер получает `raw.payload`', async () => {
    const { seen } = await run(makePipeline(), undefined, { any: 'thing' });

    expect(seen).toEqual({ any: 'thing' });
  });

  it('примитивный лист `binary` проходит как есть', async () => {
    const bytes = Buffer.from('x');
    const { seen } = await run(makePipeline(), 'binary', bytes);

    expect(seen).toBe(bytes);
  });

  it('примитивный лист `text` проходит как есть', async () => {
    const { seen } = await run(makePipeline(), 'text', 'hello');

    expect(seen).toBe('hello');
  });

  it('потоковый вход проходит как есть: элементы проверяются при чтении', async () => {
    async function* rows(): AsyncIterableIterator<Row> {
      yield { id: '1' };
    }
    const source = rows();

    const { seen } = await run(makePipeline(), stream(Row), source);

    expect(seen).toBe(source);
  });
});

describe('Форма `multipart`', () => {
  const form = multipart({
    fields: z.object({
      title: z.string().min(1),
      size: z.coerce.number(),
    }),
    files: { avatar: upload() },
  });

  it('проверяет поля и не трогает файлы', async () => {
    const files = { avatar: { field: 'avatar' } };

    const { seen, response } = await run(makePipeline(), form, {
      fields: { title: 'Cat', size: '3' },
      files,
    });

    expect(response.isSuccess).toBe(true);
    expect(seen).toEqual({
      fields: { title: 'Cat', size: 3 },
      files,
    });
    expect((seen as { files: unknown }).files).toBe(files);
  });

  it('невалидные поля дают отказ 400', async () => {
    const { response, called } = await run(makePipeline(), form, {
      fields: { title: '', size: '3' },
      files: {},
    });

    expect(called).toBe(false);
    expect(response).toMatchObject({
      isSuccess: false,
      status: 'BAD_REQUEST',
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('без схемы полей поля проходят как есть', async () => {
    const bare = multipart({ files: { avatar: upload() } });
    const payload = { fields: { anything: 1 }, files: { avatar: {} } };

    const { seen, response } = await run(makePipeline(), bare, payload);

    expect(response.isSuccess).toBe(true);
    expect(seen).toEqual(payload);
  });

  it('кандидат не объект даёт отказ 400', async () => {
    const { response } = await run(makePipeline(), form);

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'BAD_REQUEST',
      value: { code: 'VALIDATION_FAILED' },
    });
  });
});

describe('Ошибка конфигурации схемы — не ошибка входа', () => {
  it('async-схема даёт 500 и оригинал в хуке', async () => {
    const asyncSchema = fakeSchema(() => Promise.resolve({ value: {} }));
    const hookCalls: UnknownFailInfo[] = [];

    const { response } = await run(
      makePipeline(),
      asyncSchema as unknown as Schema,
      {},
      { onUnknownFail: (info) => hookCalls.push(info) },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: { code: 'UNKNOWN' },
    });
    expect(hookCalls).toHaveLength(1);
    expect((hookCalls[0].error as Error).name).toBe(
      'AsyncSchemaNotSupportedError',
    );
  });

  it('объект-не-схема даёт 500', async () => {
    const notASchema = { parse: (value: unknown) => value };
    const hookCalls: UnknownFailInfo[] = [];

    const { response } = await run(
      makePipeline(),
      notASchema as unknown as Schema,
      {},
      { onUnknownFail: (info) => hookCalls.push(info) },
    );

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'INTERNAL_ERROR',
      value: { code: 'UNKNOWN' },
    });
    expect((hookCalls[0].error as Error).name).toBe('NotAStandardSchemaError');
  });
});
