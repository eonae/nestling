/**
 * Подстановка пула `pg`: журнал команд и счёт выданных клиентов.
 *
 * Настоящая база в юнит-тестах не нужна: проверяется порядок команд и то,
 * что клиент вернулся в пул. Текст запроса подстановка не разбирает — за
 * SQL отвечают тесты на работающем PostgreSQL.
 */

import type { Pool } from 'pg';

/** Текст команды: драйвер принимает и строку, и словарь запроса */
const textOf = (query: unknown): string =>
  typeof query === 'string'
    ? query
    : String((query as { text?: unknown }).text ?? '');

/** Пустой ответ драйвера: формы результата достаточно для drizzle */
const emptyResult = {
  rows: [] as unknown[],
  rowCount: 0,
  command: '',
  oid: 0,
  fields: [] as unknown[],
};

/** Клиент подстановки: выполняет команду и возвращается в пул */
class FakeClient {
  #released = false;

  constructor(private readonly pool: FakePool) {}

  async query(query: unknown): Promise<typeof emptyResult> {
    return this.pool.run(textOf(query));
  }

  release(): void {
    if (this.#released) {
      throw new Error('клиент возвращён в пул дважды');
    }

    this.#released = true;
    this.pool.leased -= 1;
  }
}

/** Пул подстановки */
export class FakePool {
  /** Команды в порядке выполнения, включая запросы на самом пуле */
  readonly commands: string[] = [];

  /** Сколько клиентов выдано и ещё не возвращено */
  leased = 0;

  /** Закрыт ли пул */
  ended = false;

  /** Команды, на которых подстановка бросает */
  readonly failing = new Set<string>();

  async connect(): Promise<FakeClient> {
    this.leased += 1;

    return new FakeClient(this);
  }

  async query(query: unknown): Promise<typeof emptyResult> {
    return this.run(textOf(query));
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  /** Записывает команду в журнал и отвечает за неё */
  run(text: string): typeof emptyResult {
    this.commands.push(text);

    if (this.failing.has(text)) {
      throw new Error(`подстановка пула: команда '${text}' провалена`);
    }

    return emptyResult;
  }

  /**
   * Подстановка в форме пула.
   *
   * Приведение живёт здесь, а не в коде пакета: тип драйвера полон, а
   * тесту нужны четыре метода из него.
   */
  asPool(): Pool {
    return this as unknown as Pool;
  }
}
