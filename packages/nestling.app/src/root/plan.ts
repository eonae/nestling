/**
 * Словарь декларации, нормализованная декларация, план сборки и шов
 * тестового корня.
 *
 * Модуль **не** реэкспортируется из `index.ts`: наружу попадают только
 * `AppSpec` и `AppDeclaration` (через `app.ts`). План, символ шва и его
 * типы остаются внутренними — публичной точкой сборки остаётся
 * `makeApp(...).assemble(...)`, а способа остановить приложение на WIRE в
 * поверхности пакета нет.
 */

import type { Feature, FeatureSelection, Plugin } from './feature.js';
import { reachablePlugins, resolveSelection } from './feature.js';

import type { ConfigBinding } from '@nestling/config';
import type {
  BuiltContainer,
  FamilyOverrideEntry,
  Provider,
  TokenOverride,
} from '@nestling/container';
import type {
  AnyEndpointDefinition,
  Policy,
  TransportRef,
} from '@nestling/pipeline';
import type {
  BusDeclaration,
  Dispatch,
  ExecutableDeclaration,
  TransportDeclaration,
} from '@nestling/transport';

/**
 * Имена транспортов, годных в роль интеркома.
 *
 * Пусто, когда ни один объявленный транспорт не переносит операции: тогда
 * `intercom:` не принимает ничего, и назначение роли отвергает компилятор.
 */
export type IntercomName<T extends readonly TransportDeclaration[]> = Extract<
  T[number],
  BusDeclaration
>['name'];

/**
 * Словарь декларации приложения: аргумент `makeApp`.
 *
 * Каждое поле опционально: приложение из одной фичи и одного транспорта не
 * упоминает ни плагин, ни конфиг. Выбора фич здесь нет: он меняет состав
 * процесса, а не приложения, и передаётся в `app.assemble(select)`.
 *
 * @template T - Объявленные транспорты; из них выводится словарь `intercom`
 */
export interface AppSpec<
  T extends readonly TransportDeclaration[] = readonly TransportDeclaration[],
> {
  /** Фичи приложения; подмножество выбирает аргумент `assemble(select)` */
  features?: readonly Feature[];

  /**
   * Сквозная инфраструктура: логирование, метрики, документация.
   *
   * Плагины подключены всегда — они не входят в словарь выбора и не
   * выбираются.
   */
  plugins?: readonly Plugin[];

  /** Провайдеры корня (когда заводить единицу незачем) */
  providers?: readonly Provider[];

  /**
   * Транспорты корня — объявления экземпляров (`http()`, `cli()`,
   * `nats({ name: 'events' })`).
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
   * Проверяются на фазе 1 ASSEMBLE, последними из fail-fast'ов сборки: до
   * `@OnInit` не доходит ни одно нарушение. Поле опционально — приложение
   * без инвариантов собирается ровно как прежде.
   */
  policies?: readonly Policy[];
}

/** Поля словаря `makeApp`: перечень закрыт */
export const APP_SPEC_FIELDS = [
  'features',
  'plugins',
  'providers',
  'transports',
  'intercom',
  'config',
  'policies',
] as const;

/**
 * Нормализованная декларация: то, что `makeApp` проверил и запомнил.
 *
 * Плагины замкнуты по `dependsOn`, интерком найден среди транспортов,
 * списки скопированы. `select` здесь нет: он приходит в план.
 */
export interface NormalizedAppSpec {
  readonly features: readonly Feature[];
  readonly plugins: readonly Plugin[];
  readonly providers: readonly Provider[];
  readonly transports: readonly TransportDeclaration[];
  readonly intercom?: TransportDeclaration;
  readonly config: readonly ConfigBinding[];
  readonly policies: readonly Policy[];
}

/**
 * Подстановки тестового корня.
 *
 * Их принимает только шов `@nestling/app/testing`; `assemble` о них не
 * знает и не пробрасывает — подстановка есть свойство тестового прогона,
 * а не боевого.
 */
export interface TestSubstitutions {
  /** Пары «токен → фейк»: узел графа заменяется до инстанциации */
  overrides?: readonly TokenOverride<any>[];

  /** Подмены рецептов семейств — до создания членов */
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
 * Нормализованный план сборки: декларация плюс выбор и подстановки.
 *
 * Тип не покидает пакет: так `new AssembledApp({ … })` невыразим по
 * типам, и единственной публичной точкой сборки остаётся
 * `makeApp(...).assemble(...)`.
 *
 * @internal
 */
export interface AssemblyPlan {
  readonly spec: NormalizedAppSpec;

  /** Выбор фич; отсутствует — выбраны все */
  readonly select?: FeatureSelection;

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
          `selection is an argument of assembly: app.assemble(select) or ` +
          `app.check(select).`,
      );
    }

    if (field === 'overrides' || field === 'stubs') {
      throw new TypeError(
        `makeApp({ … }): '${field}' is not a field of the declaration. ` +
          `Substitutions belong to the test root: assembleTest(app, { ${field} }).`,
      );
    }

    throw new TypeError(
      `makeApp({ … }): unknown field '${field}'. Known fields: ` +
        `${APP_SPEC_FIELDS.map((known) => `'${known}'`).join(', ')}.`,
    );
  }
}

/**
 * Проверяет словарь `makeApp` и нормализует его.
 *
 * Проверки при создании — те же, что раньше делал план до выбора: бренды
 * фич и плагинов, дубли имён фич, закрытый перечень полей, интерком.
 *
 * @internal
 */
export function normalizeSpec(spec: AppSpec<any> = {}): NormalizedAppSpec {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    throw new TypeError('makeApp(spec): spec must be a dictionary object.');
  }

  assertKnownFields(spec as unknown as Record<string, unknown>);
  assertBundles(spec.features, 'feature', 'features');
  assertBundles(spec.plugins, 'plugin', 'plugins');

  // Одноимённые разные фичи — ошибка декларации, а не сборки: словарь
  // выбора должен быть однозначным уже здесь
  resolveSelection(spec.features);

  // Плагины замыкаются по `dependsOn`: вспомогательный модуль, который
  // привезли два плагина, регистрируется один раз — дедупликация ссылочная
  const plugins = reachablePlugins(spec.plugins ?? []);

  const transports = [...(spec.transports ?? [])];
  const intercom = resolveIntercom(transports, spec.intercom);

  return {
    features: [...(spec.features ?? [])],
    plugins,
    providers: [...(spec.providers ?? [])],
    transports,
    ...(intercom ? { intercom } : {}),
    config: [...(spec.config ?? [])],
    policies: [...(spec.policies ?? [])],
  };
}

/**
 * Строит план сборки: декларация, выбор и подстановки.
 *
 * Выбор здесь не резолвится: ошибки выбора — ошибки фазы ASSEMBLE, их
 * бросает `run()` или `check()`, а `assemble()` ничего не читает.
 *
 * @internal
 */
export function makePlan(
  spec: NormalizedAppSpec,
  select?: FeatureSelection,
  substitutions: TestSubstitutions = {},
): AssemblyPlan {
  return {
    spec,
    ...(select === undefined ? {} : { select }),
    overrides: [...(substitutions.overrides ?? [])],
    familyOverrides: [...(substitutions.familyOverrides ?? [])],
    extraProviders: [...(substitutions.providers ?? [])],
    ...(substitutions.config === undefined
      ? {}
      : { config: [...substitutions.config] }),
  };
}

/**
 * Ключ внутреннего шва: метод `AssembledApp`, проводящий приложение по
 * фазам 0–3 и останавливающийся.
 *
 * Символ, а не имя метода: `index.ts` его не экспортирует, поэтому у
 * прод-кода нет способа ни назвать шов, ни дотянуться до него.
 *
 * @internal
 */
export const TEST_SEAM: unique symbol = Symbol('nestling:app:test-seam');

/**
 * Ключ структурной проверки: метод `AssembledApp`, выполняющий фазы 0–1
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
  /** Собранный граф: `@OnInit` выполнены, `@OnStart` — нет */
  readonly container: BuiltContainer;

  /** Endpoint'ы приложения, адресуемые по идентичности их деклараций */
  readonly endpoints: ReadonlyMap<AnyEndpointDefinition, WiredEndpoint>;

  /** Выбранные фичи — то же, что увидел бы `run()` */
  readonly features: readonly Feature[];

  /**
   * Общий сигнал прогона: передаётся в каждый `call`, взводится на
   * `close()`.
   */
  readonly signal: AbortSignal;

  /** SHUTDOWN тестового прогона; идемпотентен */
  close(): Promise<void>;
}

/** Токены транспортов плана — для порядка запуска */
export const transportTokensOf = (
  spec: NormalizedAppSpec,
): readonly TransportRef[] => spec.transports.map(({ token }) => token);
