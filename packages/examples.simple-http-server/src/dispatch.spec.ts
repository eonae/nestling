/**
 * Endpoint'ы вызываются через `dispatch` без сокета: тот же путь исполнения,
 * что и у транспорта, но кадр запроса собирает тест.
 */

import { CreateUser, ExportLogs, SayHello } from './endpoints';

import { describe, expect, it } from '@jest/globals';
import type { EndpointMeta, Raw } from '@nestling/pipeline';
import { makeEmptyContext } from '@nestling/pipeline';
import type { ExecutableDeclaration } from '@nestling/transport';
import { makeDispatch } from '@nestling/transport';

const dispatch = makeDispatch([SayHello, CreateUser, ExportLogs]);

/** Вызывает endpoint с готовым payload, минуя разбор HTTP-запроса */
const call = (endpoint: ExecutableDeclaration, payload?: unknown) => {
  const raw: Raw = {
    transport: 'http',
    pattern: endpoint.pattern,
    payload,
    attributes: {},
  };

  const meta: EndpointMeta = {
    transport: 'http',
    pattern: endpoint.pattern,
    input: endpoint.input,
    output: endpoint.output,
    errors: endpoint.errors,
  };

  return dispatch.call(endpoint.pattern, makeEmptyContext(raw, meta));
};

describe('вызов через dispatch без сокета', () => {
  it('отдаёт значение pre-юнита хендлеру', async () => {
    const response = await call(SayHello);

    expect(response.isSuccess).toBe(true);
    expect(response.value).toMatchObject({ message: 'Hello from Nestling' });
    expect(
      Date.parse((response.value as { startedAt: string }).startedAt),
    ).not.toBeNaN();
  });

  it('проверяет вход по схеме до вызова хендлера', async () => {
    const response = await call(CreateUser, { name: '', email: 'not-mail' });

    expect(response).toMatchObject({
      isSuccess: false,
      value: { code: 'VALIDATION_FAILED' },
    });
  });

  it('возвращает объявленный отказ со статусом и кодом', async () => {
    const response = await call(CreateUser, {
      name: 'Alice',
      email: 'taken@example.com',
    });

    expect(response).toMatchObject({
      isSuccess: false,
      status: 'CONFLICT',
      value: { code: 'EMAIL_TAKEN', details: { email: 'taken@example.com' } },
    });
  });

  it('отдаёт поток как AsyncIterable', async () => {
    const response = await call(ExportLogs);
    const lines: unknown[] = [];

    for await (const line of response.value as AsyncIterable<unknown>) {
      lines.push(line);
    }

    expect(lines).toHaveLength(5);
    expect(lines[0]).toEqual({ seq: 1, message: 'line 1' });
  });
});
