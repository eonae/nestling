/**
 * `testModule` — модуль в изоляции и требование явных стабов.
 */

import { SpyTransport } from './__fixtures__/transport';
import { testModule } from './module';
import { unwrap } from './unwrap';

import { describe, expect, it } from '@jest/globals';
import { makeAppModule } from '@nestling/app';
import { Injectable, makeToken, valueProvider } from '@nestling/container';
import { Ok } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';
import { httpEndpoint, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  valueProvider(HttpTransport$, transport);

interface ILoggerService {
  log(message: string): void;
}

interface IClockService {
  now(): number;
}

const ILogger = makeToken<ILoggerService>('IsolatedLogger');
const IClock = makeToken<IClockService>('IsolatedClock');
const IUsers = makeToken<{ all(): string[] }>('IsolatedUsers');

@Injectable([ILogger, IClock, IUsers])
class ReportService {
  constructor(
    private readonly logger: ILoggerService,
    private readonly clock: IClockService,
    private readonly users: { all(): string[] },
  ) {}

  build(): { at: number; users: string[] } {
    this.logger.log('building report');
    return { at: this.clock.now(), users: this.users.all() };
  }
}

const Report = httpEndpoint({
  method: 'GET',
  path: '/report',
  output: z.object({ at: z.number(), users: z.array(z.string()) }),
  deps: [ReportService],
  handle: (reports: ReportService) => async () => new Ok(reports.build()),
});

const ReportsModule = makeAppModule({
  name: 'module:reports',
  providers: [ReportService],
  endpoints: [Report],
});

describe('testModule', () => {
  it('поднимает модуль без соседей и исполняет его ручки', async () => {
    await using app = await testModule(ReportsModule, {
      stubs: [
        [ILogger, { log: (): void => undefined }],
        [IClock, { now: () => 42 }],
        [IUsers, { all: () => ['Alice'] }],
      ],
      transports: [asHttpTransport(new SpyTransport())],
    });

    expect(unwrap(await app.call(Report))).toEqual({
      at: 42,
      users: ['Alice'],
    });
  });

  it('называет все недостающие токены, а не первый', async () => {
    const error = await testModule(ReportsModule, {
      stubs: [[ILogger, { log: (): void => undefined }]],
      transports: [asHttpTransport(new SpyTransport())],
    }).catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Unsatisfied dependencies (2)');
    expect((error as Error).message).toContain(
      `- 'IsolatedClock' required by 'ReportService'`,
    );
    expect((error as Error).message).toContain(
      `- 'IsolatedUsers' required by 'ReportService'`,
    );
  });
});
