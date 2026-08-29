/**
 * Словарь сборки, нормализованный план и шов тестового корня.
 *
 * Модуль **не** реэкспортируется из `index.ts`: наружу попадает только
 * `AssemblySpec` (через `app.ts`). План, символ шва и его типы остаются
 * внутренними — публичной точкой сборки остаётся `assemble`, а способа
 * остановить приложение на WIRE в поверхности пакета нет.
 */

import type { Feature, FeatureSelection } from './feature.js';
import { modulesOf, resolveSelection } from './feature.js';

import type { ConfigBinding } from '@nestling/config';
import type {
  BuiltContainer,
  FamilyOverrideEntry,
  InjectionToken,
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
  Dispatch,
  ExecutableDeclaration,
  ITransport,
} from '@nestling/transport';

/**
 * Словарь сборки приложения.
 *
 * Каждое поле опционально: приложение уровня L0 (модули + транспорт) не
 * упоминает ни фичу, ни `select`, ни конфиг.
 */
export interface AssemblySpec {
  /** Модули корня — они регистрируются наравне с модулями выбранных фич */
  modules?: readonly Module[];

  /** Провайдеры корня (когда заводить модуль незачем) */
  providers?: readonly Provider[];

  /** Фичи приложения; подмножество выбирается полем `select` */
  features?: readonly Feature[];

  /**
   * Выбор фич: `'all'`, `'orders,billing'` или `['orders','billing']`.
   * Отсутствует при заданных `features` — выбраны все.
   */
  select?: FeatureSelection;

  /**
   * Транспорты корня — **провайдеры** (`http()`, `cli()`), а не инстансы.
   * Сокращённая запись регистрации: тот же провайдер можно объявить в
   * `providers:` модуля, в том числе infra-модуля фичи.
   */
  transports?: readonly Provider<ITransport>[];

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
  readonly modules: readonly Module[];
  readonly providers: readonly Provider[];
  readonly transports: readonly Provider<ITransport>[];
  readonly transportTokens: readonly TransportRef[];
  readonly config: readonly ConfigBinding[];
  readonly policies: readonly Policy[];
  readonly features: readonly Feature[];
  readonly overrides: readonly TokenOverride<any>[];
  readonly familyOverrides: readonly FamilyOverrideEntry<any, any>[];
}

/** Токен, под которым провайдер транспорта регистрируется в контейнере */
function tokenOf(provider: Provider<ITransport>): TransportRef {
  const token =
    typeof provider === 'function'
      ? provider
      : (provider.provide as InjectionToken<ITransport>);

  return (typeof token === 'string' ? token : token.name) as TransportRef;
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
  spec: AssemblySpec = {},
  substitutions: TestSubstitutions = {},
): AssemblyPlan {
  const features = resolveSelection(spec.features, spec.select);

  return {
    modules: [...(spec.modules ?? []), ...modulesOf(features)],
    providers: [...(spec.providers ?? [])],
    transports: [...(spec.transports ?? [])],
    transportTokens: (spec.transports ?? []).map((provider) =>
      tokenOf(provider),
    ),
    config: [...(spec.config ?? [])],
    policies: [...(spec.policies ?? [])],
    features,
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
  /** Значение из `endpoints:` модуля — ключ поиска по идентичности */
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
