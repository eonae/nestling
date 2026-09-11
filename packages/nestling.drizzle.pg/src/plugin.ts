/**
 * `drizzlePg(options)` — форма, которой пакет отдаётся приложению.
 *
 * Соединение объявляется значением: вызов создаёт DI-токен, переменную
 * транзакции, слой и политику, и все четыре несут тип схемы этого
 * соединения. Несколько соединений — несколько вызовов с разными именами.
 */

import type { DatabaseConfigValues } from './config.js';
import { DatabaseConfig, urlKeyOf } from './config.js';
import type {
  BeginOptions,
  PgConnection,
  PgSchema,
  PgSession,
  PgTx,
} from './connection.js';
import { openConnection } from './connection.js';
import { PgDuplicateConnectionError } from './errors.js';
import type { SessionKey, TxKey } from './naming.js';
import {
  DEFAULT_CONNECTION,
  pluginNameOf,
  sessionKeyOf,
  tokenIdOf,
  txKeyOf,
} from './naming.js';

import type {
  ConfigKeys,
  ContextVar,
  EmptyInput,
  EndpointFilter,
  Logger,
  PhasedPipeline,
  Plugin,
  Policy,
  PreUnitFn,
} from '@nestlingjs/app';
import {
  contextVar,
  everyEndpoint,
  Logger$,
  makePipeline,
  makePlugin,
} from '@nestlingjs/app';
import type {
  Constructor,
  ModuleProvider,
  ResourceProviderDefinition,
  Token,
} from '@nestlingjs/container';
import { Handler, makeToken } from '@nestlingjs/container';

/** Словарь объявления соединения */
export interface DrizzlePgOptions<S extends PgSchema, N extends string> {
  /**
   * Схема drizzle этого соединения.
   *
   * Её тип доходит до значения DI-токена, до значения переменной
   * транзакции и до адаптера хранилища: обращение к чужой таблице —
   * ошибка компиляции.
   */
  readonly schema: S;

  /**
   * Имя экземпляра; без него — `default`.
   *
   * Имя задаёт ключи конфига (`DATABASE_ANALYTICS_URL`), идентификатор
   * DI-токена и ключ переменной транзакции.
   */
  readonly name?: N;
}

/** Накопленный контекст слоя транзакции: сессия и значение переменной */
export type TxLayerInput<S extends PgSchema, N extends string> = Record<
  SessionKey<N>,
  PgSession<S>
> &
  Record<TxKey<N>, PgTx<S>>;

/**
 * Класс-мост слоя: единственное, что слой берёт из контейнера.
 *
 * Он нужен, потому что `Var.provide(compute)` зависимостей из контейнера
 * не получает, а соединение приходит именно оттуда.
 */
export type TxBridgeClass<S extends PgSchema, N extends string> = Constructor<{
  handle: PreUnitFn<EmptyInput, Record<SessionKey<N>, PgSession<S>>>;
}>;

/**
 * Добавка моста в терминах ключей соединения по умолчанию.
 *
 * Замер границы ядра: `.pre` не принимает юнит, ключ добавки которого —
 * параметр типа. Проверка юнита сводит добавку через `Awaited` и
 * `Exclude`, а шаблонный ключ от параметра типа не сводится, и верный
 * юнит не проходит по типу. Поэтому слой собирается на литеральных
 * ключах, а имя экземпляра подставляет объявленный тип {@link TxLayer}:
 * в рантайме ключ считает `sessionKeyOf(name)`.
 */
type BuildTimeSession<S extends PgSchema> = Record<
  SessionKey<typeof DEFAULT_CONNECTION>,
  PgSession<S>
>;

/** Мост в тех же терминах, что {@link BuildTimeSession} */
type BuildTimeBridge<S extends PgSchema> = TxBridgeClass<
  S,
  typeof DEFAULT_CONNECTION
>;

/** Слой транзакции: пайплайн, которому нужен инстанс моста */
export type TxLayer<S extends PgSchema, N extends string> = PhasedPipeline<
  EmptyInput,
  TxLayerInput<S, N>,
  TxBridgeClass<S, N>,
  never
>;

/** Значение соединения: плагин плюс всё, чем к соединению обращаются */
export interface DrizzlePgPlugin<S extends PgSchema, N extends string>
  extends Plugin {
  /** DI-токен соединения: его объявляют в зависимостях компонента */
  readonly connection: Token<PgConnection<S>>;

  /** Переменная контекста с транзакцией запроса */
  readonly tx: ContextVar<PgTx<S>, TxKey<N>>;

  /** Ключи секции конфига — для `config:` композиционного корня */
  readonly keys: ConfigKeys;

  /**
   * Слой транзакции запроса.
   *
   * Транзакция открывается до хендлера, коммитится на успехе,
   * откатывается на отказе, и соединение возвращается в пул на любом
   * исходе.
   *
   * К потоковому ответу слой не применяется: юнит `.ok` выполняется в
   * начале ответной фазы, поэтому коммит у форм `stream` и `events`
   * прошёл бы раньше, чем хендлер дочитал курсор.
   *
   * @param options - Уровень изоляции
   *
   * @example
   * ```typescript
   * export const transactional = compose(authed, db.transaction());
   * ```
   */
  transaction(options?: BeginOptions): TxLayer<S, N>;

  /**
   * Политика: каждый endpoint под фильтром объявил переменную транзакции.
   *
   * Нарушение останавливает сборку на фазе ASSEMBLE — до фазы INIT и до
   * открытия сокета.
   *
   * @param filter - Сужение множества endpoint'ов; без него — все
   * @param label - Метка для диагностики; без неё называется ключ
   * переменной
   */
  requiresTransaction(filter?: EndpointFilter, label?: string): Policy;
}

/**
 * Объявленные имена соединений.
 *
 * Имя задаёт ключи конфига, идентификатор DI-токена и поле контекста с
 * сессией, поэтому второе объявление под тем же именем остановлено здесь,
 * а не в момент, когда два ресурса начнут читать один `DATABASE_URL`.
 */
const declared = new Set<string>();

/**
 * Объявляет соединение с PostgreSQL.
 *
 * @param options - Схема drizzle и имя экземпляра
 * @returns Плагин с DI-токеном соединения, переменной транзакции, слоем и
 * политикой
 *
 * @throws {PgDuplicateConnectionError} Имя экземпляра уже занято
 *
 * @example
 * ```typescript
 * export const db = drizzlePg({ schema });
 * export const analytics = drizzlePg({ name: 'analytics', schema: reports });
 *
 * export const app = makeApp({
 *   features: [UsersFeature],
 *   plugins: [db, analytics],
 *   config: [[dotenv('.env'), db.keys], [dotenv('.env'), analytics.keys]],
 *   transports: [http()],
 * });
 * ```
 */
export function drizzlePg<
  S extends PgSchema,
  N extends string = typeof DEFAULT_CONNECTION,
>(options: DrizzlePgOptions<S, N>): DrizzlePgPlugin<S, N> {
  const instance = options.name ?? (DEFAULT_CONNECTION as N);

  if (declared.has(instance)) {
    throw new PgDuplicateConnectionError(instance);
  }

  declared.add(instance);

  const { schema } = options;
  const section = DatabaseConfig(instance);
  const urlKey = urlKeyOf(instance);
  const sessionField = sessionKeyOf(instance);

  const Connection$ = makeToken<PgConnection<S>>(tokenIdOf(instance));
  const Tx = contextVar<PgTx<S>>()(txKeyOf(instance) as TxKey<N>);

  /** Сессия из накопленного контекста: ключ поля вычислен по имени */
  const sessionOf = (input: unknown): PgSession<S> =>
    (input as Record<string, PgSession<S>>)[sessionField];

  /** То же на ответной дорожке, где контекст неполон */
  const peekSession = (input: unknown): PgSession<S> | undefined =>
    (input as Record<string, PgSession<S> | undefined>)[sessionField];

  const connection: ResourceProviderDefinition<PgConnection<S>> = {
    provide: Connection$,
    deps: [section, Logger$('nestling:drizzle.pg')],
    acquire: (
      config: DatabaseConfigValues,
      logger: Logger,
      signal: AbortSignal,
    ) => openConnection(instance, urlKey, schema, config, logger, signal),
    release: (value: PgConnection<S>) => value.end(),
    health: (value: PgConnection<S>, signal: AbortSignal) =>
      value.health(signal),
  };

  /**
   * Мосты по уровню изоляции: класс объявляет транзакцию одной формы, а
   * форма задана аргументом слоя.
   */
  const bridges = new Map<string, BuildTimeBridge<S>>();

  const bridgeFor = (begin: BeginOptions): BuildTimeBridge<S> => {
    const key = begin.isolation ?? '';
    const known = bridges.get(key);

    if (known) {
      return known;
    }

    @Handler([Connection$])
    class OpenTransaction {
      constructor(private readonly connection: PgConnection<S>) {}

      async handle(): Promise<BuildTimeSession<S>> {
        const session = await this.connection.begin(begin);

        return { [sessionField]: session } as BuildTimeSession<S>;
      }
    }

    // Имя класса называет соединение и форму транзакции: под ним мост
    // виден в графе, в `explain()` и в тексте ошибки резолва
    Object.defineProperty(OpenTransaction, 'name', {
      value: `${tokenIdOf(instance)}#begin${key === '' ? '' : `:${key}`}`,
    });

    bridges.set(key, OpenTransaction);

    return OpenTransaction;
  };

  const plugin = makePlugin({
    name: pluginNameOf(instance),
    // Фабрика, а не список: мост создаётся вызовом `transaction(...)`, то
    // есть после объявления плагина и до сборки контейнера
    modules: [
      {
        name: pluginNameOf(instance),
        providers: (): ModuleProvider[] => [connection, ...bridges.values()],
      },
    ],
  });

  const transaction = (begin: BeginOptions = {}): TxLayer<S, N> => {
    const writer = (Tx as unknown as ContextVar<PgTx<S>, 'tx'>).provide<
      BuildTimeSession<S>
    >((ctx) => sessionOf(ctx.input).db);

    const layer = makePipeline()
      .pre(bridgeFor(begin))
      .pre(writer)
      .ok(async (_res, ctx) => {
        await sessionOf(ctx.input).commit();
      })
      /* eslint-disable-next-line unicorn/catch-error-name --
       * Это не catch-клауза, а `.catch`-юнит пайплайна: первый параметр —
       * контекст ответа-отказа, и называть его `error` было бы неверно. */
      .catch(async (_res, ctx) => {
        await peekSession(ctx.input)?.rollback();
      })
      .finally(async (_outcome, _res, ctx) => {
        await peekSession(ctx.input)?.release();
      });

    // Слой собран на ключах соединения по умолчанию, а объявленный тип
    // подставляет ключи экземпляра: см. `BuildTimeSession`
    return layer as unknown as TxLayer<S, N>;
  };

  return Object.freeze({
    ...plugin,
    connection: Connection$,
    tx: Tx,
    keys: section.keys,
    transaction,
    requiresTransaction: (
      filter: EndpointFilter = {},
      label?: string,
    ): Policy =>
      label === undefined
        ? everyEndpoint(filter).hasVar(Tx)
        : everyEndpoint(filter).hasVar(Tx, label),
  });
}
