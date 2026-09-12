/**
 * Карта сессий клиентов — состояние экземпляра транспорта.
 *
 * Сессия заводится на `initialize` и хранит согласованную версию протокола
 * со сведениями о клиенте. Отдельного ресурса карте не нужно: у транспорта
 * уже есть жизненный цикл, и `close()` на SHUTDOWN очищает её.
 *
 * Роста карта не даёт по двум правилам: число сессий ограничено, а сессия
 * без запросов дольше объявленного срока закрывается. Просроченные записи
 * убираются при обращении к карте, поэтому своего таймера у неё нет.
 */

import { randomUUID } from 'node:crypto';

import type { McpRuntimeOptions } from './options.js';
import type { ProtocolVersion } from './protocol.js';

/** Пределы карты сессий: то, что она читает из опций транспорта */
export type McpSessionLimits = Pick<
  McpRuntimeOptions,
  'sessionIdleMs' | 'sessionLimit'
>;

/** Сведения о клиенте из `initialize` */
export interface McpClientInfo {
  readonly name?: string;
  readonly version?: string;
}

/** Открытая сессия клиента */
export interface McpSession {
  /** Идентификатор; уходит клиенту заголовком `Mcp-Session-Id` */
  readonly id: string;

  /** Версия протокола, согласованная на `initialize` */
  readonly protocolVersion: ProtocolVersion;

  /** Сведения о клиенте */
  readonly client: McpClientInfo;

  /** Момент последнего запроса; по нему считается бездействие */
  lastSeen: number;
}

/** Сессий столько же, сколько разрешено: новую заводить некуда */
export class McpSessionLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `The server already holds ${limit} open MCP session(s), which is the ` +
        `declared limit. Close a session with DELETE on the transport path, ` +
        `or raise 'sessionLimit' in the mcp(...) options.`,
    );
    this.name = 'McpSessionLimitError';
  }
}

/**
 * Карта «идентификатор сессии — сведения о клиенте».
 *
 * @example
 * ```typescript
 * const session = sessions.open('2025-06-18', { name: 'claude' });
 * sessions.get(session.id)?.protocolVersion;
 * ```
 */
export class McpSessions {
  readonly #sessions = new Map<string, McpSession>();

  constructor(private readonly limits: McpSessionLimits) {}

  /** Число открытых сессий; просроченные уже убраны */
  get size(): number {
    this.#sweep();
    return this.#sessions.size;
  }

  /**
   * Заводит сессию.
   *
   * @throws {McpSessionLimitError} Открытых сессий столько же, сколько
   * разрешено опцией `sessionLimit`
   */
  open(protocolVersion: ProtocolVersion, client: McpClientInfo): McpSession {
    this.#sweep();

    if (this.#sessions.size >= this.limits.sessionLimit) {
      throw new McpSessionLimitError(this.limits.sessionLimit);
    }

    const session: McpSession = {
      id: randomUUID(),
      protocolVersion,
      client,
      lastSeen: Date.now(),
    };

    this.#sessions.set(session.id, session);

    return session;
  }

  /**
   * Находит сессию и отмечает её как живую.
   *
   * @returns Сессия либо `undefined`, если её нет или срок бездействия вышел
   */
  get(id: string): McpSession | undefined {
    this.#sweep();

    const session = this.#sessions.get(id);
    if (session === undefined) {
      return undefined;
    }

    session.lastSeen = Date.now();

    return session;
  }

  /**
   * Закрывает сессию.
   *
   * @returns Была ли такая сессия открыта
   */
  close(id: string): boolean {
    return this.#sessions.delete(id);
  }

  /** Очистка на остановке транспорта: открытых сессий не остаётся */
  clear(): void {
    this.#sessions.clear();
  }

  /** Убирает сессии, которые молчали дольше объявленного срока */
  #sweep(): void {
    const oldest = Date.now() - this.limits.sessionIdleMs;

    for (const [id, session] of this.#sessions) {
      if (session.lastSeen < oldest) {
        this.#sessions.delete(id);
      }
    }
  }
}
