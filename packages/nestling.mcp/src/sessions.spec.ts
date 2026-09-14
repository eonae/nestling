/**
 * Карта сессий: предел, срок бездействия и очистка на остановке.
 */

import { DEFAULT_SESSION_IDLE_MS, DEFAULT_SESSION_LIMIT } from './options.js';
import type { McpSessionLimits } from './sessions.js';
import { McpSessionLimitError, McpSessions } from './sessions.js';

import { describe, expect, it, vi } from 'vitest';

const sessionsOf = (overrides: Partial<McpSessionLimits> = {}) =>
  new McpSessions({
    sessionLimit: DEFAULT_SESSION_LIMIT,
    sessionIdleMs: DEFAULT_SESSION_IDLE_MS,
    ...overrides,
  });

describe('McpSessions', () => {
  it('заводит сессию и находит её по идентификатору', () => {
    const sessions = sessionsOf();
    const session = sessions.open('2025-06-18', { name: 'claude' });

    expect(sessions.get(session.id)).toMatchObject({
      protocolVersion: '2025-06-18',
      client: { name: 'claude' },
    });
  });

  it('не находит сессию, которой нет', () => {
    const sessions = sessionsOf();

    expect(sessions.get('missing')).toBeUndefined();
  });

  it('закрывает сессию по идентификатору', () => {
    const sessions = sessionsOf();
    const session = sessions.open('2025-06-18', {});

    expect(sessions.close(session.id)).toBe(true);
    expect(sessions.get(session.id)).toBeUndefined();
    expect(sessions.close(session.id)).toBe(false);
  });

  it('отвергает сессию сверх предела, называя его', () => {
    const sessions = sessionsOf({ sessionLimit: 1 });
    sessions.open('2025-06-18', {});

    expect(() => sessions.open('2025-06-18', {})).toThrow(McpSessionLimitError);
    expect(() => sessions.open('2025-06-18', {})).toThrow(/already holds 1/);
  });

  it('закрывает сессию, молчавшую дольше срока бездействия', () => {
    vi.useFakeTimers();

    try {
      const sessions = sessionsOf({ sessionIdleMs: 1000 });
      const session = sessions.open('2025-06-18', {});

      vi.advanceTimersByTime(999);
      expect(sessions.get(session.id)).toBeDefined();

      vi.advanceTimersByTime(1001);
      expect(sessions.get(session.id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('продлевает сессию каждым обращением', () => {
    vi.useFakeTimers();

    try {
      const sessions = sessionsOf({ sessionIdleMs: 1000 });
      const session = sessions.open('2025-06-18', {});

      for (let i = 0; i < 5; i += 1) {
        vi.advanceTimersByTime(900);
        expect(sessions.get(session.id)).toBeDefined();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('оставляет карту пустой после очистки', () => {
    const sessions = sessionsOf();
    sessions.open('2025-06-18', {});
    sessions.open('2025-06-18', {});

    expect(sessions.size).toBe(2);

    sessions.clear();

    expect(sessions.size).toBe(0);
  });
});
