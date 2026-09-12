/**
 * Карта сессий: предел, срок бездействия и освобождение ресурса.
 */

import type { McpRuntimeOptions } from './options.js';
import { DEFAULT_SESSION_IDLE_MS, DEFAULT_SESSION_LIMIT } from './options.js';
import { McpSessionLimitError, McpSessions } from './sessions.js';

import { describe, expect, it, jest } from '@jest/globals';

const options = (overrides: Partial<McpRuntimeOptions> = {}) => ({
  server: { name: 'test', version: '1.0.0' },
  sessionLimit: DEFAULT_SESSION_LIMIT,
  sessionIdleMs: DEFAULT_SESSION_IDLE_MS,
  ...overrides,
});

const sessionsOf = (overrides: Partial<McpRuntimeOptions> = {}) =>
  McpSessions.acquire(options(overrides), new AbortController().signal);

describe('McpSessions', () => {
  it('заводит сессию и находит её по идентификатору', async () => {
    const sessions = await sessionsOf();
    const session = sessions.open('2025-06-18', { name: 'claude' });

    expect(sessions.get(session.id)).toMatchObject({
      protocolVersion: '2025-06-18',
      client: { name: 'claude' },
    });
  });

  it('не находит сессию, которой нет', async () => {
    const sessions = await sessionsOf();

    expect(sessions.get('missing')).toBeUndefined();
  });

  it('закрывает сессию по идентификатору', async () => {
    const sessions = await sessionsOf();
    const session = sessions.open('2025-06-18', {});

    expect(sessions.close(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
    expect(sessions.close(session.id)).toBe(false);
  });

  it('отвергает сессию сверх предела, называя его', async () => {
    const sessions = await sessionsOf({ sessionLimit: 1 });
    sessions.open('2025-06-18', {});

    expect(() => sessions.open('2025-06-18', {})).toThrow(McpSessionLimitError);
    expect(() => sessions.open('2025-06-18', {})).toThrow(/already holds 1/);
  });

  it('закрывает сессию, молчавшую дольше срока бездействия', async () => {
    jest.useFakeTimers();

    try {
      const sessions = await sessionsOf({ sessionIdleMs: 1000 });
      const session = sessions.open('2025-06-18', {});

      jest.advanceTimersByTime(999);
      expect(sessions.get(session.id)).toBeDefined();

      jest.advanceTimersByTime(1001);
      expect(sessions.get(session.id)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('продлевает сессию каждым обращением', async () => {
    jest.useFakeTimers();

    try {
      const sessions = await sessionsOf({ sessionIdleMs: 1000 });
      const session = sessions.open('2025-06-18', {});

      for (let i = 0; i < 5; i += 1) {
        jest.advanceTimersByTime(900);
        expect(sessions.get(session.id)).toBeDefined();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('оставляет карту пустой после release', async () => {
    const sessions = await sessionsOf();
    sessions.open('2025-06-18', {});
    sessions.open('2025-06-18', {});

    expect(sessions.size).toBe(2);

    sessions.release();

    expect(sessions.size).toBe(0);
  });
});
