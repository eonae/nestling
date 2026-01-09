import type { RequestContext, ResponseContext } from '@nestling/pipeline';
import { TimingMiddleware } from './timing.middleware';
import type { ILoggerService } from '../../logger/logger.service';
import { mock } from 'jest-mock-extended';

describe('TimingMiddleware', () => {
  let middleware: TimingMiddleware;
  let logger: jest.Mocked<ILoggerService>;

  beforeEach(() => {
    logger = mock<ILoggerService>();
    middleware = new TimingMiddleware(logger);
  });

  it('должен вызвать next() и вернуть его результат', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };

    const expectedResponse: ResponseContext = {
      isSuccess: true,
      status: 'OK',
      value: { data: 'test' },
    };

    const next = jest.fn().mockResolvedValue(expectedResponse);

    const result = await middleware.apply(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(result).toEqual(expectedResponse);
  });

  it('должен логировать время выполнения', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };

    const next = jest.fn().mockResolvedValue({
      status: 'OK',
      value: {},
    });

    await middleware.apply(ctx, next);

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[http\] GET \/test - started/),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[http\] GET \/test - completed in \d+ms/),
    );
  });

  it('должен добавить заголовок X-Response-Time', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };

    const next = jest.fn().mockResolvedValue({
      status: 'OK',
      value: {},
    });

    const result = await middleware.apply(ctx, next);

    expect(result.headers).toBeDefined();
    expect(result.headers?.['X-Response-Time']).toMatch(/\d+ms/);
  });

  it('должен пропустить ошибки из next()', async () => {
    const ctx: RequestContext = {
      transport: 'http',
      pattern: 'GET /test',
      payload: {},
      metadata: {},
    };

    const error = new Error('Test error');
    const next = jest.fn().mockRejectedValue(error);

    await expect(middleware.apply(ctx, next)).rejects.toThrow(error);
  });
});

