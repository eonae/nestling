/**
 * Слушатель-фейк для спеков композиционного корня: DI-токен экземпляра,
 * конструктор объявления и отметки фаз.
 *
 * Спеки этого пакета проверяют порядок шагов, а не работу конкретного
 * сервера: им нужен узел графа, который отмечает `acquire`, `listen`,
 * `drain` и `release`. Настоящий `HttpServer` дал бы то же самое ценой
 * зависимости на пакет, который сам зависит от `@nestlingjs/app`.
 */

import type { TransportCapabilities } from '../../pipeline/index.js';
import type {
  IListener,
  ITransport,
  ServerDeclaration,
  TransportDeclaration,
} from '../../transport/index.js';
import {
  DEFAULT_INSTANCE,
  makeServerDeclaration,
  makeTransportDeclaration,
} from '../../transport/index.js';

import { TestTransport$ } from './test-transport.js';

import type { TokenFamily } from '@nestlingjs/container';
import {
  makeTokenFamily,
  resourceProvider,
  valueProvider,
} from '@nestlingjs/container';

/** Семейство DI-токенов слушателя-фейка: один член на экземпляр */
export const TestServer$: TokenFamily<TestListener, [instance: string]> =
  makeTokenFamily<TestListener, [instance: string]>('server:test');

/**
 * Слушатель-фейк: вместо сокета — флаг и отметка в общем журнале.
 *
 * Журнал один на прогон, поэтому по нему видно и порядок шагов между
 * узлами, и порядок ролей внутри узла.
 */
export class TestListener implements IListener {
  /** `listen()` был, `drain()` — ещё нет */
  listening = false;

  constructor(
    readonly name: string,
    private readonly marks: string[],
  ) {}

  async listen(): Promise<void> {
    this.marks.push(`listen:${this.name}`);
    this.listening = true;
  }

  async drain(): Promise<void> {
    this.marks.push(`drain:${this.name}`);
    this.listening = false;
  }

  async release(): Promise<void> {
    this.marks.push(`release:${this.name}`);
  }
}

/**
 * Транспорт-фейк, который отмечает `serve` и `close` в общем журнале.
 */
export class MarkingTransport implements ITransport {
  constructor(
    readonly name: string,
    private readonly marks: string[],
  ) {}

  async serve(): Promise<void> {
    this.marks.push(`serve:${this.name}`);
  }

  async close(): Promise<void> {
    this.marks.push(`close:${this.name}`);
  }
}

/** Способности транспорта-фейка: только value-формы */
const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

/**
 * Объявляет слушателя-фейка.
 *
 * @param options - Имя экземпляра и журнал отметок
 * @returns Объявление сервера для `transports:` корня
 */
export function testServer(options: {
  name?: string;
  marks: string[];
}): ServerDeclaration<string> {
  const name = options.name ?? DEFAULT_INSTANCE;
  const token = TestServer$(name);

  return makeServerDeclaration({
    name,
    token,
    provider: resourceProvider(token, {
      deps: [] as const,
      acquire: () => {
        options.marks.push(`acquire:${name}`);

        return new TestListener(name, options.marks);
      },
      release: (listener: TestListener) => listener.release(),
    }),
  });
}

/**
 * Объявляет транспорт-фейк, работающий на переданном сервере.
 *
 * @param options - Имя экземпляра, его сервер и журнал отметок
 * @returns Объявление транспорта для `transports:` корня
 */
export function testTransport(options: {
  name?: string;
  server: ServerDeclaration;
  marks: string[];
}): TransportDeclaration<string> {
  const name = options.name ?? DEFAULT_INSTANCE;
  const token = TestTransport$(name);

  return makeTransportDeclaration({
    name,
    token,
    capabilities: VALUE_ONLY,
    server: options.server,
    provider: valueProvider(token, new MarkingTransport(name, options.marks)),
  });
}
