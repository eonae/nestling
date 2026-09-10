/**
 * `testUnit` — модуль в изоляции и требование явных стабов.
 */

import { HTTP_LIKE, SpyTransport } from './__fixtures__/transport.js';
import { testUnit } from './unit.js';
import { unwrap } from './unwrap.js';

import { describe, expect, it } from '@jest/globals';
import type { ITransport } from '@nestlingjs/app';
import { makeFeature, Ok, transportValue } from '@nestlingjs/app';
import { Component, Handler, makeToken } from '@nestlingjs/container';
import type { HttpServer } from '@nestlingjs/transport.http';
import {
  http,
  httpEndpoint,
  HttpServer$,
  HttpTransport$,
} from '@nestlingjs/transport.http';
import { z } from 'zod';

const asHttpTransport = (transport: ITransport) =>
  transportValue(HttpTransport$('default'), transport, {
    capabilities: HTTP_LIKE,
  });

interface ILoggerService {
  log(message: string): void;
}

interface IClockService {
  now(): number;
}

const ILogger = makeToken<ILoggerService>('IsolatedLogger');
const IClock = makeToken<IClockService>('IsolatedClock');
const IUsers = makeToken<{ all(): string[] }>('IsolatedUsers');

@Component([ILogger, IClock, IUsers])
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

@Handler([ReportService])
class ReportHandler {
  constructor(private readonly reports: ReportService) {}

  async handle() {
    return new Ok(this.reports.build());
  }
}

const Report = httpEndpoint({
  method: 'GET',
  path: '/report',
  output: z.object({ at: z.number(), users: z.array(z.string()) }),
  handler: ReportHandler,
});

const ReportsModule = makeFeature({
  name: 'module:reports',
  providers: [ReportService],
  endpoints: [Report],
});

describe('testUnit', () => {
  it("поднимает модуль без соседей и исполняет его endpoint'ы", async () => {
    await using app = await testUnit(ReportsModule, {
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

  it('настоящий `http()` собирается без порта и не открывает сокет', async () => {
    // Тестовая сборка останавливается на WIRE, поэтому `listen` не
    // вызывается вовсе: порт в `vars` нужен только боевому прогону
    await using app = await testUnit(ReportsModule, {
      stubs: [
        [ILogger, { log: (): void => undefined }],
        [IClock, { now: () => 42 }],
        [IUsers, { all: () => ['Alice'] }],
      ],
      transports: [http()],
    });

    const server = app.get(HttpServer$('default')) as HttpServer;

    expect(server.address()).toBeNull();
    expect(unwrap(await app.call(Report))).toEqual({
      at: 42,
      users: ['Alice'],
    });
  });

  it('называет все недостающие DI-токены, а не первый', async () => {
    const error = await testUnit(ReportsModule, {
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
