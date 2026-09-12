/**
 * Карта сессий клиентов.
 *
 * Сессия заводится на `initialize` и хранит согласованную версию протокола
 * со сведениями о клиенте. Карта живёт ресурсом: контейнер захватывает её
 * на INIT и освобождает на SHUTDOWN, поэтому после остановки приложения
 * открытых сессий не остаётся.
 *
 * Роста карта не даёт по двум правилам: число сессий ограничено, а сессия
 * без запросов дольше объявленного срока закрывается. Просроченные записи
 * убираются при обращении к карте, поэтому своего таймера у ресурса нет.
 */

import { randomUUID } from 'node:crypto';

import type { McpRuntimeOptions } from './options.js';
import { McpOptions$ } from './options.js';
import type { ProtocolVersion } from './protocol.js';

import { Resource } from '@nestlingjs/container';

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
        `declared limit. Close a session with DELETE on the endpoint path, ` +
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
@Resource([McpOptions$])
export class McpSessions {
  readonly #sessions = new Map<string, McpSession>();

  static acquire(
    options: McpRuntimeOptions,
    _signal: AbortSignal,
  ): Promise<McpSessions> {
    return Promise.resolve(new McpSessions(options));
  }

  private constructor(private readonly options: McpRuntimeOptions) {}

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

    if (this.#sessions.size >= this.options.sessionLimit) {
      throw new McpSessionLimitError(this.options.sessionLimit);
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

  /** Освобождение на SHUTDOWN: после него открытых сессий не остаётся */
  release(): void {
    this.#sessions.clear();
  }

  /** Убирает сессии, которые молчали дольше объявленного срока */
  #sweep(): void {
    const oldest = Date.now() - this.options.sessionIdleMs;

    for (const [id, session] of this.#sessions) {
      if (session.lastSeen < oldest) {
        this.#sessions.delete(id);
      }
    }
  }
}
