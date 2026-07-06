/**
 * Рантайм-тесты Pipeline.executeWithHandler
 *
 * В отличие от pipeline.spec.ts (типовые проверки), здесь проверяется реальное
 * поведение выполнения: нормализация ответа и политика раскрытия ошибок
 * (exposeErrorDetails).
 */

import type { EmptyInput } from './io/io';
import type { EndpointMeta, ExtendableContext } from './types/context';
import { makeEmptyContext } from './types/context';
import type { Raw } from './types/raw';
import { definePipeline } from './pipeline';
import { Fail, Ok } from './result';

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

const failingHandler = (): never => {
  throw Fail.badRequest('Email already taken', { field: 'email' });
};

describe('Pipeline.executeWithHandler — runtime', () => {
  it('нормализует голое значение в OK', async () => {
    const pipeline = definePipeline();

    const response = await pipeline.executeWithHandler(
      () => ({ hello: 'world' }),
      makeCtx(),
    );

    expect(response).toEqual({
      isSuccess: true,
      status: 'OK',
      value: { hello: 'world' },
    });
  });

  it('сохраняет статус и заголовки из Ok', async () => {
    const pipeline = definePipeline();

    const response = await pipeline.executeWithHandler(
      () => new Ok('CREATED', { id: 1 }, { 'x-test': '1' }),
      makeCtx(),
    );

    expect(response).toEqual({
      isSuccess: true,
      status: 'CREATED',
      value: { id: 1 },
      headers: { 'x-test': '1' },
    });
  });

  describe('политика раскрытия ошибок', () => {
    it('Fail сохраняет message и details независимо от exposeErrorDetails', async () => {
      const pipeline = definePipeline();

      const withoutOpt = await pipeline.executeWithHandler(
        failingHandler,
        makeCtx(),
      );
      expect(withoutOpt).toEqual({
        isSuccess: false,
        status: 'BAD_REQUEST',
        value: { error: 'Email already taken', details: { field: 'email' } },
      });

      const withOpt = await pipeline.executeWithHandler(
        failingHandler,
        makeCtx(),
        { exposeErrorDetails: true },
      );
      expect(withOpt.value).toEqual({
        error: 'Email already taken',
        details: { field: 'email' },
      });
    });

    it('не-Fail по умолчанию — generic без message и stack', async () => {
      const pipeline = definePipeline();

      const response = await pipeline.executeWithHandler(() => {
        throw new Error('db password invalid');
      }, makeCtx());

      expect(response.isSuccess).toBe(false);
      expect(response.status).toBe('INTERNAL_ERROR');
      expect(response.value).toEqual({ error: 'Internal server error' });
      expect(JSON.stringify(response.value)).not.toContain('db password');
      expect((response.value as { stack?: string }).stack).toBeUndefined();
    });

    it('не-Fail с exposeErrorDetails: true — message и stack раскрыты', async () => {
      const pipeline = definePipeline();

      const response = await pipeline.executeWithHandler(
        () => {
          throw new Error('boom');
        },
        makeCtx(),
        { exposeErrorDetails: true },
      );

      expect(response.isSuccess).toBe(false);
      expect(response.status).toBe('INTERNAL_ERROR');
      expect((response.value as { error: string }).error).toBe('boom');
      expect((response.value as { stack?: string }).stack).toContain('boom');
    });

    it('не-Error значение с раскрытием — Unknown error', async () => {
      const pipeline = definePipeline();

      const response = await pipeline.executeWithHandler(
        () => {
          throw 'string error';
        },
        makeCtx(),
        { exposeErrorDetails: true },
      );

      expect((response.value as { error: string }).error).toBe('Unknown error');
    });
  });
});
