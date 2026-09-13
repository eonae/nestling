/**
 * Словарь декларации, нормализованная декларация, план сборки и шов
 * тестового корня.
 *
 * Модуль **не** реэкспортируется из `index.ts`: наружу попадают только
 * `AppSpec` и `AppDeclaration` (через `app.ts`). План, символ шва и его
 * типы остаются внутренними — публичной точкой сборки остаётся
 * `makeApp(...).build(...)`, а способа остановить приложение на WIRE в
 * поверхности пакета нет.
 */

import type { ConfigBinding } from '../config/index.js';
import type { Logger } from '../logger/index.js';
import type { Metrics } from '../metrics/index.js';
import type {
  AnyEndpointDefinition,
  Policy,
  TransportRef,
} from '../pipeline/index.js';
import type {
  BusDeclaration,
  Dispatch,
  ExecutableDeclaration,
  ServerDeclaration,
  TransportDeclaration,
} from '../transport/index.js';

import type { BuildArgs } from './args.js';
import { RESERVED_ARG_FIELDS } from './args.js';
import type { Feature, Plugin, ResolvedBundle } from './feature.js';
import { resolveSelection } from './feature.js';

import type {
  AnySwitch,
  Branchable,
  BuiltContainer,
  FamilyOverrideEntry,
  Module,
  ModuleProvider,
  Provider,
  TokenOverride,
} from '@nestlingjs/container';
import { branchCandidates } from '@nestlingjs/container';

/**
 * Имена транспортов, годных в роль интеркома.
 *
 * Пусто, когда ни один объявленный транспорт не переносит операции: тогда
 * `intercom:` не принимает ничего, и назначение роли отвергает компилятор.
 * Транспорт под веткой переключателя в словарь не входит: роль интеркома
 * назначается тому, кто есть в каждой сборке.
 */
export type IntercomName<
  T extends readonly Branchable<TransportDeclaration>[],
> = Extract<T[number], BusDeclaration>['name'];

/**
 * Общая часть словаря `makeApp`: поля, которые есть у всех трёх форм
 * состава.
 *
 * @template T - Объявленные транспорты; из них выводится словарь `intercom`
 * @template S - Объявленные переключатели; из них выводится аргумент сборки
 */
export interface AppSpecCommon<
  T extends readonly Branchable<TransportDeclaration>[],
  S extends readonly AnySwitch[],
> {
  /**
   * Сквозная инфраструктура: логирование, метрики, документация.
   *
   * Плагины подключены всегда — они не входят в словарь выбора и не
   * выбираются. Ветка переключателя стоит здесь наравне с плагином.
   */
  plugins?: readonly Branchable<Plugin>[];

  /**
   * Переключатели состава приложения.
   *
   * Из списка выводится тип аргумента сборки: поле переключателя с
   * умолчанием необязательно, без умолчания обязательно. Без поля
   * переключателей у приложения нет, и аргумент принимает только
   * `features` и `includeDeps`.
   */
  switches?: S;

  /**
   * Корневой логгер приложения — готовое значение.
   *
   * Единственный способ заменить `ConsoleLogger` ядра: провайдер под
   * `RootLogger$` в `providers:` становится ошибкой дубля. Значение
   * обязано быть готовым: корень существует раньше графа и потому не может
   * зависеть от его узлов. Записи всех фаз, включая предупреждения
   * сборки, уходят сюда, а токены семейства `Logger$(scope)` строятся от него.
   */
  logger?: Logger;

  /**
   * Корень метрик приложения — готовое значение.
   *
   * Единственный способ заменить пустую реализацию ядра: провайдер под
   * `RootMetrics$` в `providers:` становится ошибкой дубля. Опция и
   * включает инструментовку ядра: без неё рантайм не снимает время и не
   * вызывает методы записи, а токены семейства `Metrics$(scope)` пишут в никуда.
   */
  metrics?: Metrics;

  /**
   * Транспорты корня — объявления экземпляров (`http()`, `cli()`,
   * `nats({ name: 'events' })`).
   *
   * Только транспорты. Сокет держит отдельный узел — сервер, — и в сборку
   * он попадает по ссылке: `http({ server: api })`. Объявление сервера,
   * попавшее в список, отвергается на фазе BUILD.
   */
  transports?: T;

  /**
   * Транспорт, переносящий объявленные операции между процессами.
   *
   * Не второе объявление, а **роль**: имя уже объявленного транспорта.
   * Годятся только те, что реализуют `IMessageBus`; остальные отвергает
   * компилятор.
   */
  intercom?: IntercomName<T>;

  /**
   * Привязки источников конфигурации: `[источник, таргет | таргет[]]`.
   *
   * Порядок задаёт приоритет. `process.env` — источник по умолчанию с
   * низшим приоритетом и в списке не упоминается. Приложению, которому
   * хватает env, поле не нужно вовсе:
   * kernel-модуль конфига регистрируется всегда.
   */
  config?: readonly ConfigBinding[];

  /**
   * Инварианты приложения — значения словаря политик
   * (`everyEndpoint({ … }).hasLayer(…)`).
   *
   * Проверяются на фазе 1 BUILD, последними из fail-fast'ов сборки: до
   * INIT не доходит ни одно нарушение. Поле опционально — приложение
   * без инвариантов собирается ровно как прежде.
   */
  policies?: readonly Policy[];
}

/**
 * Словарь декларации приложения: аргумент `makeApp`.
 *
 * Состав описывается ровно одной из трёх форм, и это проверяет тип:
 * `{ endpoints, providers? }`, `{ endpoints, modules? }` или
 * `{ features }`. Первые две — состав одной фичи без имени; их endpoint'ы
 * атрибутируются единице с именем `app`. Выбора фич здесь нет: он меняет
 * состав процесса, а не приложения, и передаётся в
 * `app.build(args)`.
 *
 * @template T - Объявленные транспорты; из них выводится словарь `intercom`
 * @template S - Объявленные переключатели; из них выводится аргумент сборки
 */
export type AppSpec<
  T extends
    readonly Branchable<TransportDeclaration>[] = readonly Branchable<TransportDeclaration>[],
  S extends readonly AnySwitch[] = readonly AnySwitch[],
> =
  | (AppSpecCommon<T, S> & {
      /** Endpoint'ы корня; их обслуживает единица с именем `app` */
      endpoints: readonly Branchable<AnyEndpointDefinition>[];

      /** Провайдеры корня; их узлы несут метку модуля `app` */
      providers?: readonly Branchable<ModuleProvider>[];

      modules?: never;
      features?: never;
    })
  | (AppSpecCommon<T, S> & {
      /** Endpoint'ы корня; их обслуживает единица с именем `app` */
      endpoints: readonly Branchable<AnyEndpointDefinition>[];

      /** Модули корня; их узлы несут метки своих модулей */
      modules?: readonly Branchable<Module>[];

      providers?: never;
      features?: never;
    })
  | (AppSpecCommon<T, S> & {
      /** Фичи приложения; подмножество выбирает аргумент сборки */
      features?: readonly Feature[];

      endpoints?: never;
      providers?: never;
      modules?: never;
    });

/** Поля словаря `makeApp`: перечень закрыт */
export const APP_SPEC_FIELDS = [
  'features',
  'endpoints',
  'modules',
  'plugins',
  'providers',
  'switches',
  'transports',
  'intercom',
  'config',
  'policies',
  'logger',
  'metrics',
] as const;

/**
 * Нормализованная декларация: то, что `makeApp` проверил и запомнил.
 *
 * Корень плоских форм превращён в единицу `app`, интерком найден среди
 * транспортов, списки скопированы. Ветки переключателей остаются
 * нераскрытыми: значения известны только сборке. Аргумента сборки здесь
 * нет — он приходит в план.
 */
export interface NormalizedAppSpec {
  readonly features: readonly Feature[];
  /**
   * Единица корня: состав форм `{ endpoints, providers? }` и
   * `{ endpoints, modules? }` под именем `app`.
   *
   * Отсутствует у формы с `features:`. В выбор не входит и не
   * выбирается — она и есть корень.
   */
  readonly root?: Feature;

  readonly plugins: readonly Branchable<Plugin>[];
  readonly switches: readonly AnySwitch[];

  /**
   * Объявления транспортов в порядке объявления, ветки нераскрыты.
   *
   * Серверы здесь не лежат: их собирает сборка по полям `server` — до
   * раскрытия веток состав списка неизвестен.
   */
  readonly transports: readonly Branchable<TransportDeclaration>[];
  readonly intercom?: TransportDeclaration;
  readonly config: readonly ConfigBinding[];
  readonly policies: readonly Policy[];

  /** Корневой логгер корня; без него им служит `ConsoleLogger` ядра */
  readonly logger?: Logger;

  /** Корень метрик; без него им служит пустая реализация ядра */
  readonly metrics?: Metrics;
}

/**
 * Подстановки тестового корня.
 *
 * Их принимает только шов `@nestlingjs/app/testing`; `build` о них не
 * знает и не пробрасывает — подстановка есть свойство тестового прогона,
 * а не боевого.
 */
export interface TestSubstitutions {
  /** Пары «DI-токен → фейк»: узел графа заменяется до инстанциации */
  overrides?: readonly TokenOverride<any>[];

  /** Подмены рецептов семейств — до создания DI-токенов */
  familyOverrides?: readonly FamilyOverrideEntry<any, any>[];

  /** Поставка недостающего: провайдеры, добавленные к провайдерам корня */
  providers?: readonly Provider[];

  /**
   * Привязка источников конфига тестового прогона.
   *
   * **Заменяет** привязку декларации целиком: тест изолирован от
   * источников приложения так же, как от `process.env`.
   */
  config?: readonly ConfigBinding[];
}

/**
 * Нормализованный план сборки: декларация плюс аргумент и подстановки.
 *
 * Тип не покидает пакет: так `new BuiltApp({ … })` невыразим по
 * типам, и единственной публичной точкой сборки остаётся
 * `makeApp(...).build(...)`.
 *
 * @internal
 */
export interface BuildPlan {
  readonly spec: NormalizedAppSpec;

  /** Аргумент сборки; отсутствует — выбраны все фичи и умолчания */
  readonly args?: BuildArgs<any>;

  readonly overrides: readonly TokenOverride<any>[];
  readonly familyOverrides: readonly FamilyOverrideEntry<any, any>[];

  /** Провайдеры тестового прогона (стабы); в бою пусто */
  readonly extraProviders: readonly Provider[];

  /** Привязка конфига, заменяющая привязку декларации; в бою отсутствует */
  readonly config?: readonly ConfigBinding[];
}

/**
 * Находит объявление транспорта, назначенного в роль интеркома.
 *
 * Имя, которого нет среди объявленных, — опечатка: типы её не поймают,
 * когда шина одна и её имя выводится литералом.
 */
function resolveIntercom(
  transports: readonly TransportDeclaration[],
  intercom: string | undefined,
): TransportDeclaration | undefined {
  if (intercom === undefined) {
    const unassigned = transports.find((declaration) => 'bus' in declaration);

    if (unassigned) {
      throw new Error(
        `Transport '${unassigned.name}' carries declared operations, but no ` +
          `intercom role is assigned, so nothing would be delivered through ` +
          `it. Add 'intercom: ${JSON.stringify(unassigned.name)}' to ` +
          `makeApp({ … }), or drop the transport.`,
      );
    }

    return undefined;
  }

  const declaration = transports.find(({ name }) => name === intercom);

  if (!declaration) {
    const declared = transports.map(({ name }) => `'${name}'`).join(', ');

    throw new Error(
      `'intercom: ${JSON.stringify(intercom)}' names a transport that is not ` +
        `declared. Declared transports: ${declared || '(none)'}. The intercom ` +
        `role is assigned to a transport already listed in 'transports:'.`,
    );
  }

  if (!('bus' in declaration)) {
    throw new Error(
      `Transport '${intercom}' cannot take the intercom role: it does not ` +
        `carry declared operations. Assign a bus transport (for example ` +
        `nats({ name: '${intercom}' })).`,
    );
  }

  return declaration;
}

/**
 * Проверяет, что `transports:` перечисляет только транспорты.
 *
 * Компилятор отвергает сервер в списке, но декларацию пишут и из
 * JavaScript. Проверка идёт до `collectServers`: иначе сервер молча
 * пропал бы из сборки.
 *
 * @param candidates - Кандидаты поля `transports:` всех веток
 * @throws {TypeError} Элемент списка — объявление сервера
 */
function assertTransports(candidates: readonly TransportDeclaration[]): void {
  for (const candidate of candidates) {
    if ((candidate as { kind: string }).kind === 'server') {
      throw new TypeError(
        `makeApp({ … }): 'transports' takes transport declarations only, ` +
          `but got a server declaration named '${candidate.name}'. Pass the ` +
          `server to the transport that works on it: ` +
          `http({ server: theServer }).`,
      );
    }
  }
}

/**
 * Собирает серверы сборки: объявления из полей `server` транспортов.
 *
 * Сервер, названный несколькими транспортами, штатно встречается
 * несколько раз, поэтому повтор **той же** ссылки даёт одну регистрацию.
 * Два **разных** объявления с одним именем — ошибка: имя задаёт префикс
 * конфиг-секции сервера, и молча выбрать одно из двух значит выбрать за
 * автора, чей порт слушать.
 *
 * Сервер, на который не ссылается ни один транспорт, в сборку не
 * попадает: узел берётся из ссылки, ссылки нет — узла нет.
 *
 * @param transports - Объявления транспортов в порядке объявления
 * @returns Объявления серверов без повторов, в порядке первого упоминания
 * @throws {Error} Два разных объявления сервера с одним именем
 */
export function collectServers(
  transports: readonly TransportDeclaration[],
): readonly ServerDeclaration[] {
  const byName = new Map<string, ServerDeclaration>();

  for (const { server } of transports) {
    if (!server) {
      continue;
    }

    const existing = byName.get(server.name);

    if (existing === server) {
      continue;
    }

    if (existing) {
      throw new Error(
        `Two different server declarations are named '${server.name}'. ` +
          `The name is the prefix of the server's config section, so both ` +
          `would read the same port. Declare the server once ` +
          `(const api = server({ name: '${server.name}' })) and pass that ` +
          `value to every transport that works on it.`,
      );
    }

    byName.set(server.name, server);
  }

  return [...byName.values()];
}

/** Проверяет, что каждый элемент списка — единица нужной роли */
function assertBundles(
  values: unknown,
  role: 'feature' | 'plugin',
  field: 'features' | 'plugins',
): void {
  if (values === undefined) {
    return;
  }

  if (!Array.isArray(values)) {
    throw new TypeError(
      `makeApp({ … }): '${field}' must be an array of values created by ` +
        `${role === 'feature' ? 'makeFeature' : 'makePlugin'}().`,
    );
  }

  for (const [index, value] of values.entries()) {
    if ((value as { role?: unknown } | undefined)?.role !== role) {
      throw new TypeError(
        `makeApp({ … }): ${field}[${index}] is not a ${role} — expected a ` +
          `value created by ${role === 'feature' ? 'makeFeature' : 'makePlugin'}().`,
      );
    }
  }
}

/** Отвергает поле вне закрытого перечня, называя, куда оно делось */
function assertKnownFields(spec: Record<string, unknown>): void {
  for (const field of Object.keys(spec)) {
    if ((APP_SPEC_FIELDS as readonly string[]).includes(field)) {
      continue;
    }

    if (field === 'select') {
      throw new TypeError(
        `makeApp({ … }): 'select' is not a field of the declaration. The ` +
          `selection is part of the build argument: app.build(args) or ` +
          `app.check(args).`,
      );
    }

    if (field === 'overrides' || field === 'stubs') {
      throw new TypeError(
        `makeApp({ … }): '${field}' is not a field of the declaration. ` +
          `Substitutions belong to the test root: buildTest(app, { ${field} }).`,
      );
    }

    throw new TypeError(
      `makeApp({ … }): unknown field '${field}'. Known fields: ` +
        `${APP_SPEC_FIELDS.map((known) => `'${known}'`).join(', ')}.`,
    );
  }
}

/** Имя внутренней единицы, в которую нормализуется корень плоских форм */
export const ROOT_STEP_NAME = 'app';

/** Три допустимые формы состава — для сообщения о смешанной записи */
const COMPOSITION_FORMS = `{ endpoints, providers? }, { endpoints, modules? } or { features }`;

/**
 * Отвергает смешанную запись состава, называя три допустимые формы.
 *
 * Типы такую запись уже не пропускают, но JS-потребителей типы не
 * сдерживают: без проверки половина состава молча потерялась бы.
 */
function assertComposition(spec: Record<string, unknown>): void {
  const flat = spec['endpoints'] !== undefined;
  const grouped = spec['features'] !== undefined;

  if (flat && grouped) {
    throw new TypeError(
      `makeApp({ … }): 'endpoints' and 'features' describe the composition ` +
        `twice. Declare exactly one of ${COMPOSITION_FORMS}.`,
    );
  }

  if (spec['providers'] !== undefined && spec['modules'] !== undefined) {
    throw new TypeError(
      `makeApp({ … }): 'providers' and 'modules' describe the composition ` +
        `twice. Declare exactly one of ${COMPOSITION_FORMS}.`,
    );
  }

  if (
    !flat &&
    (spec['providers'] !== undefined || spec['modules'] !== undefined)
  ) {
    const field = spec['providers'] === undefined ? 'modules' : 'providers';

    throw new TypeError(
      `makeApp({ … }): '${field}' needs 'endpoints:' beside it — it is the ` +
        `composition of the root step. A provider shared by several features ` +
        `is declared by a plugin (makePlugin), so that the edge 'feature → ` +
        `provider' has an owner. Declare exactly one of ${COMPOSITION_FORMS}.`,
    );
  }
}

/**
 * Проверяет словарь `switches:`: значения-переключатели, занятые имена и
 * дубли.
 */
function normalizeSwitches(values: unknown): readonly AnySwitch[] {
  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new TypeError(
      `makeApp({ … }): 'switches' must be an array of values created by ` +
        `makeSwitch().`,
    );
  }

  const byName = new Map<string, AnySwitch>();

  for (const [index, declared] of (values as AnySwitch[]).entries()) {
    if (typeof declared?.name !== 'string' || !Array.isArray(declared.values)) {
      throw new TypeError(
        `makeApp({ … }): switches[${index}] is not a switch — expected a ` +
          `value created by makeSwitch().`,
      );
    }

    if ((RESERVED_ARG_FIELDS as readonly string[]).includes(declared.name)) {
      throw new Error(
        `Switch '${declared.name}' cannot be declared: the build argument ` +
          `already has a field with that name. Rename the switch.`,
      );
    }

    const seen = byName.get(declared.name);

    if (seen && seen !== declared) {
      throw new Error(
        `Two different switches are named '${declared.name}'. The name is the ` +
          `field of the build argument, so it must be unique.`,
      );
    }

    byName.set(declared.name, declared);
  }

  return [...(values as AnySwitch[])];
}

/**
 * Собирает единицу корня из плоской формы состава.
 *
 * Дальше состав однороден: discovery, атрибуция модулей, карта владельцев
 * и проверка границ работают одним кодом.
 */
function normalizeRoot(spec: {
  endpoints?: readonly Branchable<AnyEndpointDefinition>[];
  providers?: readonly Branchable<ModuleProvider>[];
  modules?: readonly Branchable<Module>[];
}): Feature | undefined {
  if (spec.endpoints === undefined) {
    return undefined;
  }

  if (!Array.isArray(spec.endpoints)) {
    throw new TypeError(
      `makeApp({ … }): 'endpoints' must be an array of endpoint declarations.`,
    );
  }

  const modules: readonly Branchable<Module>[] = spec.providers
    ? [{ name: ROOT_STEP_NAME, providers: [...spec.providers] }]
    : [...(spec.modules ?? [])];

  return Object.freeze({
    role: 'feature' as const,
    name: ROOT_STEP_NAME,
    modules: Object.freeze(modules),
    endpoints: Object.freeze([...spec.endpoints]),
  });
}

/**
 * Проверяет словарь `makeApp` и нормализует его.
 *
 * Проверки при создании — те же, что раньше делал план до выбора: бренды
 * фич и плагинов, дубли имён фич и имён переключателей, форма состава,
 * закрытый перечень полей, интерком.
 *
 * @internal
 */
export function normalizeSpec(spec: AppSpec<any, any> = {}): NormalizedAppSpec {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new TypeError('makeApp(spec): spec must be a dictionary object.');
  }

  const fields = spec as unknown as Record<string, unknown>;

  assertKnownFields(fields);
  assertComposition(fields);
  assertBundles(spec.features, 'feature', 'features');
  assertBundles(branchCandidates(spec.plugins), 'plugin', 'plugins');

  // Одноимённые разные фичи — ошибка декларации, а не сборки: словарь
  // выбора должен быть однозначным уже здесь
  resolveSelection(spec.features);

  const root = normalizeRoot(spec);

  // Состав списка, имена серверов и интерком проверяются по кандидатам
  // всех веток: и роль, и имя назначаются объявлению, а не сборке,
  // поэтому опечатка ловится здесь — а не в той сборке, куда попала ветка
  const transports = [...(spec.transports ?? [])];
  const candidates = branchCandidates(transports);

  assertTransports(candidates);
  collectServers(candidates);

  const intercom = resolveIntercom(candidates, spec.intercom);

  return {
    features: [...(spec.features ?? [])],
    ...(root ? { root } : {}),
    plugins: [...(spec.plugins ?? [])],
    switches: normalizeSwitches(spec.switches),
    transports,
    ...(intercom ? { intercom } : {}),
    config: [...(spec.config ?? [])],
    policies: [...(spec.policies ?? [])],
    ...(spec.logger ? { logger: spec.logger } : {}),
    ...(spec.metrics ? { metrics: spec.metrics } : {}),
  };
}

/**
 * Строит план сборки: декларация, аргумент и подстановки.
 *
 * Аргумент здесь не разбирается: его ошибки — ошибки фазы BUILD, их
 * бросает `run()` или `check()`, а `build()` ничего не читает.
 *
 * @internal
 */
export function makePlan(
  spec: NormalizedAppSpec,
  args?: BuildArgs<any>,
  substitutions: TestSubstitutions = {},
): BuildPlan {
  return {
    spec,
    ...(args === undefined ? {} : { args }),
    overrides: [...(substitutions.overrides ?? [])],
    familyOverrides: [...(substitutions.familyOverrides ?? [])],
    extraProviders: [...(substitutions.providers ?? [])],
    ...(substitutions.config === undefined
      ? {}
      : { config: [...substitutions.config] }),
  };
}

/**
 * Ключ внутреннего шва: метод `BuiltApp`, проводящий приложение по
 * фазам 0–3 и останавливающийся.
 *
 * Символ, а не имя метода: `index.ts` его не экспортирует, поэтому у
 * прод-кода нет способа ни назвать шов, ни дотянуться до него.
 *
 * @internal
 */
export const TEST_SEAM: unique symbol = Symbol('nestling:app:test-seam');

/**
 * Ключ структурной проверки: метод `BuiltApp`, выполняющий фазы 0–1
 * и отдающий отчёт. Публично проверку зовут через `App.check()`.
 *
 * @internal
 */
export const CHECK_SEAM: unique symbol = Symbol('nestling:app:check-seam');

/**
 * Endpoint с резолвенными на фазе WIRE зависимостями: исходная декларация
 * и всё, чем его исполнить.
 */
export interface WiredEndpoint {
  /** Значение из `endpoints:` фичи или плагина — ключ поиска по идентичности */
  readonly declaration: AnyEndpointDefinition;

  /** Её исполнимая копия (зависимости резолвены контейнером) */
  readonly executable: ExecutableDeclaration;

  /** Диспетчер транспорта этого endpoint'а */
  readonly dispatch: Dispatch;

  /** Модуль, объявивший endpoint */
  readonly moduleName: string;
}

/**
 * Приложение, остановленное после фазы 3 WIRE.
 *
 * `dispatch` создан, START не выполнялся: транспорты ещё не принимают
 * запросы, обработчики сигналов процесса не поставлены, строка состава
 * не напечатана.
 */
export interface WiredApp {
  /** Собранный граф: экземпляры созданы и ресурсы захвачены, `@OnStart` — нет */
  readonly container: BuiltContainer;

  /** Endpoint'ы приложения, адресуемые по идентичности их деклараций */
  readonly endpoints: ReadonlyMap<AnyEndpointDefinition, WiredEndpoint>;

  /** Выбранные фичи — то же, что увидел бы `run()` */
  readonly features: readonly ResolvedBundle[];

  /**
   * Общий сигнал прогона: передаётся в каждый `call`, взводится на
   * `close()`.
   */
  readonly signal: AbortSignal;

  /** SHUTDOWN тестового прогона; идемпотентен */
  close(): Promise<void>;
}

/** DI-токены объявленных транспортов — для порядка запуска */
export const transportTokensOf = (
  transports: readonly TransportDeclaration[],
): readonly TransportRef[] => transports.map(({ token }) => token);
