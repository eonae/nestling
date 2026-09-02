/**
 * Словарь сборки, нормализованный план и шов тестового корня.
 *
 * Модуль **не** реэкспортируется из `index.ts`: наружу попадает только
 * `AssemblySpec` (через `app.ts`). План, символ шва и его типы остаются
 * внутренними — публичной точкой сборки остаётся `assemble`, а способа
 * остановить приложение на WIRE в поверхности пакета нет.
 */

import type { Feature, FeatureSelection, Plugin } from './feature.js';
import { modulesOf, reachablePlugins, resolveSelection } from './feature.js';

import type { ConfigBinding } from '@nestling/config';
import type {
  BuiltContainer,
  FamilyOverrideEntry,
  Module,
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
  ITransport,
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
 * Словарь сборки приложения.
 *
 * Каждое поле опционально: приложение из одной фичи и одного транспорта не
 * упоминает ни плагин, ни `select`, ни конфиг.
 *
 * @template T - Объявленные транспорты; из них выводится словарь `intercom`
 */
export interface AssemblySpec<
  T extends readonly TransportDeclaration[] = readonly TransportDeclaration[],
> {
  /** Фичи приложения; подмножество выбирается полем `select` */
  features?: readonly Feature[];

  /**
   * Сквозная инфраструктура: логирование, метрики, документация.
   *
   * Плагины подключены всегда — они не входят в словарь `select` и не
   * выбираются.
   */
  plugins?: readonly Plugin[];

  /** Провайдеры корня (когда заводить единицу незачем) */
  providers?: readonly Provider[];

  /**
   * Выбор фич: `'all'`, `'orders,billing'`, `['orders','billing']` или
   * `{ features, includeDeps }`.
   * Отсутствует при заданных `features` — выбраны все.
   */
  select?: FeatureSelection;

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
}

/**
 * Нормализованный план сборки.
 *
 * Тип не покидает пакет: так `new App({ … })` невыразим по типам, и
 * единственной публичной точкой сборки остаётся `assemble`.
 *
 * @internal
 */
export interface AssemblyPlan {
  readonly features: readonly Feature[];
  readonly plugins: readonly Plugin[];
  readonly modules: readonly Module[];
  readonly providers: readonly Provider[];
  readonly transports: readonly Provider<ITransport>[];
  readonly transportTokens: readonly TransportRef[];
  readonly intercom?: TransportDeclaration;
  readonly includeDeps: boolean;
  readonly declaredFeatures: ReadonlyMap<string, Feature>;
  readonly config: readonly ConfigBinding[];
  readonly policies: readonly Policy[];
  readonly overrides: readonly TokenOverride<any>[];
  readonly familyOverrides: readonly FamilyOverrideEntry<any, any>[];
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
 * Нормализует словарь сборки в план.
 *
 * Фаза 0 начинается здесь: резолв выбора идёт до построения контейнера,
 * поэтому опечатка в имени фичи падает раньше любого `@OnInit`.
 *
 * @internal
 */
export function makePlan(
  spec: AssemblySpec<any> = {},
  substitutions: TestSubstitutions = {},
): AssemblyPlan {
  const selection = resolveSelection(spec.features, spec.select);

  // Плагины замыкаются по `dependsOn`: вспомогательный модуль, который
  // привезли два плагина, регистрируется один раз — дедупликация ссылочная
  const plugins = reachablePlugins(spec.plugins ?? []);

  const transports = [...(spec.transports ?? [])];
  const intercom = resolveIntercom(transports, spec.intercom);

  return {
    features: selection.features,
    plugins,
    modules: modulesOf([...selection.features, ...plugins]),
    providers: [...(spec.providers ?? [])],
    transports: transports.map(({ provider }) => provider),
    transportTokens: transports.map(({ token }) => token),
    ...(intercom ? { intercom } : {}),
    includeDeps: selection.includeDeps,
    declaredFeatures: selection.declared,
    config: [...(spec.config ?? [])],
    policies: [...(spec.policies ?? [])],
    overrides: [...(substitutions.overrides ?? [])],
    familyOverrides: [...(substitutions.familyOverrides ?? [])],
  };
}

/**
 * Ключ внутреннего шва: метод `App`, проводящий приложение по фазам 0–3 и
 * останавливающийся.
 *
 * Символ, а не имя метода: `index.ts` его не экспортирует, поэтому у
 * прод-кода нет способа ни назвать шов, ни дотянуться до него.
 *
 * @internal
 */
export const TEST_SEAM: unique symbol = Symbol('nestling:app:test-seam');

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
