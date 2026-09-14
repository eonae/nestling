/**
 * Конверт JSON-RPC 2.0 и список поддерживаемых версий протокола.
 *
 * Версии сверяются со списком SDK: он объявляет свой как `string[]`, и
 * типом эту сверку не выразить. Разбор конверта проверяется здесь же — без
 * HTTP и без поднятия приложения.
 */

import {
  JsonRpcErrorCode,
  parseMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol.js';

import { SUPPORTED_PROTOCOL_VERSIONS as SDK_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

describe('версии протокола', () => {
  it('каждая объявленная версия входит в список SDK', () => {
    for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(SDK_VERSIONS).toContain(version);
    }
  });

  it('первая объявленная версия — самая свежая из объявленных', () => {
    const sorted = [...SUPPORTED_PROTOCOL_VERSIONS].sort().reverse();

    expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual(sorted);
  });
});

describe('parseMessage(body)', () => {
  it('разбирает запрос с идентификатором', () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');

    expect(parsed).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
  });

  it('разбирает нотификацию без идентификатора', () => {
    const parsed = parseMessage(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    );

    expect(parsed).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
  });

  it('отвечает кодом разбора на тело, которое не JSON', () => {
    const parsed = parseMessage('{ not json');

    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.response.error.code).toBe(
      JsonRpcErrorCode.ParseError,
    );
    expect(parsed.ok === false && parsed.response.id).toBeNull();
  });

  it('отвергает пачку сообщений', () => {
    const parsed = parseMessage('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');

    expect(parsed.ok === false && parsed.response.error.code).toBe(
      JsonRpcErrorCode.InvalidRequest,
    );
  });

  it('отвергает сообщение без поля jsonrpc', () => {
    const parsed = parseMessage('{"id":1,"method":"ping"}');

    expect(parsed.ok === false && parsed.response.error.code).toBe(
      JsonRpcErrorCode.InvalidRequest,
    );
    expect(parsed.ok === false && parsed.response.id).toBe(1);
  });

  it('отвергает сообщение без метода', () => {
    const parsed = parseMessage('{"jsonrpc":"2.0","id":2}');

    expect(parsed.ok === false && parsed.response.error.code).toBe(
      JsonRpcErrorCode.InvalidRequest,
    );
  });

  it('отбрасывает параметры, которые не объект', () => {
    const parsed = parseMessage(
      '{"jsonrpc":"2.0","id":3,"method":"ping","params":[1,2]}',
    );

    expect(parsed).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', id: 3, method: 'ping' },
    });
  });
});
