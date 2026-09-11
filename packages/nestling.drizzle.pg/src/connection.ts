/**
 * Соединение и сессия: то, что пакет кладёт под DI-токен экземпляра.
 *
 * Транзакция открывается командой на соединении, выданном пулом, а не
 * колбэком `db.transaction(cb)`: колбэк пришлось бы держать незавершённым
 * весь запрос, и потерянный сигнал завершения исчерпывал бы пул.
 */

import type { DatabaseConfigValues } from './config.js';
import { PgConnectionFailedError } from './errors.js';

import type { Logger } from '@nestlingjs/app';
import type { HealthStatus } from '@nestlingjs/container';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import pg from 'pg';

/** Схема drizzle: рекорд объявлений таблиц и отношений */
export type PgSchema = Record<string, unknown>;

/**
 * Значение переменной транзакции: экземпляр drizzle, привязанный к
 * открытой транзакции. Репозиторий пишет им обычный запрос.
 */
export type PgTx<S extends PgSchema> = NodePgDatabase<S>;

/** Уровень изоляции транзакции */
export type IsolationLevel =
  | 'read committed'
  | 'repeatable read'
  | 'serializable';

/** Аргументы открытия транзакции */
export interface BeginOptions {
  /** Уровень изоляции; без него — умолчание сервера */
  readonly isolation?: IsolationLevel;
}

/** Команда открытия транзакции с уровнем изоляции */
export const beginCommand = (options: BeginOptions): string =>
  options.isolation === undefined
    ? 'BEGIN'
    : `BEGIN ISOLATION LEVEL ${options.isolation.toUpperCase()}`;

/**
 * Обрывает ожидание по сигналу.
 *
 * Драйвер `pg` сигнала не принимает, поэтому ожидание гонится с ним:
 * запрос продолжит выполняться на сервере, но старт приложения или
 * проба не зависнут на нём.
 */
const withSignal = async <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> =>
  await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason as Error);

        return;
      }

      signal.addEventListener('abort', () => reject(signal.reason as Error), {
        once: true,
      });
    }),
  ]);

/**
 * Сессия: транзакция, открытая на одном соединении пула.
 *
 * Завершение идемпотентно во всех трёх формах — повтор на завершённой
 * сессии ни одной команды в базу не шлёт. Слой пайплайна вызывает
 * `release` всегда, а `commit` или `rollback` — по исходу запроса, и эти
 * пути пересекаются на отмене.
 */
export class PgSession<S extends PgSchema> {
  /** Открыта ли транзакция: после `commit` или `rollback` — нет */
  #open = true;

  /** Отдан ли клиент обратно в пул */
  #released = false;

  constructor(
    /** Экземпляр drizzle, привязанный к этой транзакции */
    readonly db: PgTx<S>,
    private readonly client: PoolClient,
  ) {}

  /** Фиксирует транзакцию */
  async commit(): Promise<void> {
    if (!this.#open) {
      return;
    }

    // Отметка стоит до команды: провалившийся `COMMIT` откатывает
    // транзакцию на сервере, и слать `ROLLBACK` следом не нужно
    this.#open = false;
    await this.client.query('COMMIT');
  }

  /** Откатывает транзакцию */
  async rollback(): Promise<void> {
    if (!this.#open) {
      return;
    }

    this.#open = false;
    await this.client.query('ROLLBACK');
  }

  /**
   * Возвращает клиента в пул, откатив незавершённую транзакцию.
   *
   * Вызывается на любом исходе запроса, включая обрыв связи с клиентом и
   * остановку приложения: занятое соединение, за которое никто не
   * отвечает, исчерпывает пул.
   */
  async release(): Promise<void> {
    if (this.#released) {
      return;
    }

    this.#released = true;

    try {
      await this.rollback();
    } finally {
      this.client.release();
    }
  }
}

/**
 * Соединение: пул, экземпляр drizzle на нём и выдача сессии.
 *
 * Значение живёт под DI-токеном экземпляра. Читающий метод репозитория
 * берёт `db`, изменяющий — переменную транзакции.
 */
export class PgConnection<S extends PgSchema> {
  /** Экземпляр drizzle на пуле: запросы вне транзакции */
  readonly db: NodePgDatabase<S>;

  constructor(
    private readonly pool: Pool,
    private readonly schema: S,
    /** Потолок времени одного запроса в транзакции; `0` — без потолка */
    private readonly statementTimeoutMs: number,
  ) {
    this.db = drizzle(pool, { schema });
  }

  /**
   * Открывает транзакцию на соединении из пула.
   *
   * Клиент, на котором не удалось открыть транзакцию, возвращается в пул
   * сразу: иначе ошибка таймаута съедала бы пул по одному соединению за
   * запрос.
   */
  async begin(options: BeginOptions = {}): Promise<PgSession<S>> {
    const client = await this.pool.connect();

    try {
      await client.query(beginCommand(options));

      if (this.statementTimeoutMs > 0) {
        // `LOCAL` — на время транзакции: клиент вернётся в пул без следа
        await client.query(
          `SET LOCAL statement_timeout = ${this.statementTimeoutMs}`,
        );
      }
    } catch (error) {
      client.release();
      throw error;
    }

    return new PgSession(drizzle(client, { schema: this.schema }), client);
  }

  /** Живо ли соединение: один запрос с сигналом вызывающего */
  async health(signal: AbortSignal): Promise<HealthStatus> {
    try {
      await withSignal(this.pool.query('SELECT 1'), signal);

      return 'ok';
    } catch {
      return 'down';
    }
  }

  /** Закрывает пул: вызывается освобождением ресурса */
  async end(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Закрывает пул, не заслоняя исходную ошибку своей.
 *
 * Пул, который не подключился, закрывать нечем: провал закрытия ничего не
 * добавляет к провалу подключения, а вот подменить его — может.
 */
async function closeQuietly(pool: Pool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // Пул не открылся: эта ошибка не важнее той, из-за которой мы здесь
  }
}

/**
 * Открывает пул и проверяет его первым запросом.
 *
 * Ввода-вывода на фазе сборки нет: функция зовётся захватом ресурса, то
 * есть на фазе INIT. Недоступная база останавливает старт, и текст
 * ошибки называет имя соединения и ключ конфига с адресом.
 *
 * @param connection - Имя экземпляра соединения
 * @param urlKey - Имя ключа конфига с адресом
 * @param schema - Схема drizzle этого соединения
 * @param config - Проекция секции соединения
 * @param logger - Логгер: в него уходит хост, а не адрес целиком
 * @param signal - Сигнал остановки старта
 */
export async function openConnection<S extends PgSchema>(
  connection: string,
  urlKey: string,
  schema: S,
  config: DatabaseConfigValues,
  logger: Logger,
  signal: AbortSignal,
): Promise<PgConnection<S>> {
  const pool = new pg.Pool({
    connectionString: config.url,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    ...(config.ssl ? { ssl: true } : {}),
  });

  try {
    await withSignal(pool.query('SELECT 1'), signal);
  } catch (error) {
    await closeQuietly(pool);

    throw new PgConnectionFailedError(connection, urlKey, { cause: error });
  }

  // В лог уходит только хост: адрес целиком несёт пароль
  logger.info('database connected', { connection, host: config.host });

  return new PgConnection(pool, schema, config.statementTimeoutMs);
}
