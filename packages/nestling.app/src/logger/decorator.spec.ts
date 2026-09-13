/**
 * Декоратор полей корреляции: поля внутри запроса, их отсутствие вне
 * запроса, приоритет поля вызова, проекция и дочерний логгер.
 */

import { makeCell, runInScope } from '../pipeline/core/context/store.js';
import { contextVar } from '../pipeline/core/context/variable.js';
import { RequestId, Trace } from '../pipeline/core/context/well-known.js';

import { spyLogger } from './__fixtures__/spy.js';
import type { LogFieldsPlan } from './decorator.js';
import { withLogFields } from './decorator.js';
import { collectLogFields, logField } from './fields.js';

import { describe, expect, it } from '@jest/globals';
import type { Logger } from '@nestlingjs/logging';

const TRACE = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  sampled: true,
};

/** Список полей корня: те же два поля, что стоят умолчанием */
const plan = (...fields: Parameters<typeof collectLogFields>[0][0]['fields']) =>
  ({
    fields: collectLogFields([{ owner: 'test', fields }]),
  }) satisfies LogFieldsPlan;

/** Исполняет тело внутри запроса с заданным накопленным `input` */
const inRequest = <T>(input: Record<string, unknown>, body: () => T): T =>
  runInScope(makeCell(new AbortController().signal, input), body);

describe('withLogFields: поля корреляции', () => {
  it('внутри запроса запись несёт поле объявленной переменной', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ requestId: 'req-42' }, () => logger.info('select'));

    expect(spy.entries).toEqual([
      { level: 'info', message: 'select', fields: { requestId: 'req-42' } },
    ]);
  });

  it('вне запроса полей нет', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    logger.info('started');

    expect(spy.entries[0]?.fields).toEqual({});
  });

  it('переменной нет в контексте — поля нет', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ tenant: 'acme' }, () => logger.info('select'));

    expect(spy.entries[0]?.fields).toEqual({});
  });

  it('поле вызова сильнее поля корреляции', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ requestId: 'req-42' }, () =>
      logger.info('select', { requestId: 'manual' }),
    );

    expect(spy.entries[0]?.fields).toEqual({ requestId: 'manual' });
  });

  it('проекция кладёт в запись часть значения', () => {
    const spy = spyLogger();
    const logger = withLogFields(
      spy.logger,
      plan(logField(Trace, 'traceId', (trace) => trace.traceId)),
    );

    inRequest({ trace: TRACE }, () => logger.info('select'));

    expect(spy.entries[0]?.fields).toEqual({ traceId: TRACE.traceId });
  });

  it('переменная без обёртки даёт поле с именем переменной', () => {
    const spy = spyLogger();
    const Tenant = contextVar<string>()('tenant');
    const logger = withLogFields(spy.logger, plan(Tenant));

    inRequest({ tenant: 'acme' }, () => logger.info('select'));

    expect(spy.entries[0]?.fields).toEqual({ tenant: 'acme' });
  });

  it('переименование без проекции меняет только имя поля', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(logField(RequestId, 'req')));

    inRequest({ requestId: 'req-42' }, () => logger.info('select'));

    expect(spy.entries[0]?.fields).toEqual({ req: 'req-42' });
  });

  it('пустой список отключает корреляцию', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan());

    inRequest({ requestId: 'req-42' }, () => logger.info('select'));

    expect(spy.entries[0]?.fields).toEqual({});
  });
});

describe('withLogFields: формы вызова и дочерний логгер', () => {
  it('дочерний логгер несёт и привязки, и поля корреляции', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ requestId: 'req-42' }, () =>
      logger.child({ table: 'users' }).info('select'),
    );

    expect(spy.entries[0]?.fields).toEqual({
      table: 'users',
      requestId: 'req-42',
    });
  });

  it('поля ставятся один раз: внуку они не удваиваются', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ requestId: 'req-42' }, () =>
      logger.child({ a: 1 }).child({ b: 2 }).info('select'),
    );

    expect(spy.entries[0]?.fields).toEqual({
      a: 1,
      b: 2,
      requestId: 'req-42',
    });
  });

  it('форма с ошибкой несёт и отказ, и поля корреляции', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));
    const error = new Error('boom');

    inRequest({ requestId: 'req-42' }, () => logger.error(error));

    expect(spy.entries[0]).toMatchObject({
      level: 'error',
      message: 'boom',
      fields: { requestId: 'req-42', err: error },
    });
  });

  it('форма только с полями несёт поля корреляции', () => {
    const spy = spyLogger();
    const logger = withLogFields(spy.logger, plan(RequestId));

    inRequest({ requestId: 'req-42' }, () => logger.debug({ rows: 3 }));

    expect(spy.entries[0]?.fields).toEqual({ rows: 3, requestId: 'req-42' });
  });

  it('список пополняется после создания декоратора', () => {
    const spy = spyLogger();
    const fields: LogFieldsPlan = { fields: [] };
    const logger: Logger = withLogFields(spy.logger, fields);

    inRequest({ requestId: 'req-42' }, () => logger.info('before'));

    fields.fields = collectLogFields([{ owner: 'test', fields: [RequestId] }]);

    inRequest({ requestId: 'req-42' }, () => logger.info('after'));

    expect(spy.entries.map(({ fields: f }) => f)).toEqual([
      {},
      { requestId: 'req-42' },
    ]);
  });
});
