/**
 * Фича — бандл модулей как **значение** и резолвер выбора.
 *
 * Новой машинерии контейнера фичи не вводят: `select` отдаёт билдеру модули
 * выбранных фич, а «не выбрал фичу → её провайдеров нет» получается само из
 * жадного контейнера.
 */

import type { Module } from '@nestling/container';

/**
 * Фича приложения: имя, её модули и фичи, без которых она не работает.
 *
 * Значение без побочных эффектов: глобального реестра фич нет, поэтому
 * `dependsOn` ссылается на **значения**, а не на имена.
 */
export interface Feature {
  /** Имя фичи; им же она называется в `select` */
  readonly name: string;

  /** Модули фичи — они уедут в контейнер, если фича выбрана */
  readonly modules: readonly Module[];

  /**
   * Фичи, без которых эта не работает. Транзитивно достижимые участвуют в
   * сборке, даже если не перечислены в `features:` корня.
   */
  readonly dependsOn: readonly Feature[];
}

/** Словарь объявления фичи */
export interface FeatureOptions {
  name: string;
  modules: readonly Module[];
  dependsOn?: readonly Feature[];
}

/**
 * Форма `select`: `'all'`, `'orders,billing'` или `['orders', 'billing']`.
 *
 * Строковая форма — граница процесса (аргумент бинарника, переменная
 * окружения), она строковая по природе; опечатка ловится fail-fast'ом с
 * перечнем доступных имён.
 */
export type FeatureSelection = string | readonly string[];

/**
 * Объявляет фичу.
 *
 * @param options - Имя, модули и ссылки на фичи-зависимости
 * @returns Значение-фичу; ничего не регистрируется, пока её не выбрали
 *
 * @example
 * ```typescript
 * export const OrdersFeature = makeFeature({
 *   name: 'orders',
 *   modules: [OrdersModule],
 *   dependsOn: [SharedFeature],
 * });
 * ```
 *
 * @throws {Error} Пустое имя или не-массив в `modules`/`dependsOn`
 */
export function makeFeature(options: FeatureOptions): Feature {
  const { name, modules, dependsOn = [] } = options;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error("makeFeature({ … }): 'name' must be a non-empty string.");
  }

  if (!Array.isArray(modules)) {
    throw new TypeError(
      `makeFeature({ name: '${name}' }): 'modules' must be an array of modules.`,
    );
  }

  if (!Array.isArray(dependsOn)) {
    throw new TypeError(
      `makeFeature({ name: '${name}' }): 'dependsOn' must be an array of ` +
        `features — values returned by makeFeature(), not their names.`,
    );
  }

  return Object.freeze({
    name,
    modules: Object.freeze([...modules]),
    dependsOn: Object.freeze([...dependsOn]),
  });
}

/**
 * Все фичи, достижимые из перечисленных по `dependsOn`.
 *
 * Обход с множеством посещённых: цикл в `dependsOn` легален — поле
 * описывает необходимость, а не порядок построения.
 */
function reachable(features: readonly Feature[]): Feature[] {
  const seen = new Set<Feature>();
  const known: Feature[] = [];

  const visit = (feature: Feature): void => {
    if (seen.has(feature)) {
      return;
    }
    seen.add(feature);
    known.push(feature);

    for (const dependency of feature.dependsOn) {
      visit(dependency);
    }
  };

  for (const feature of features) {
    visit(feature);
  }

  return known;
}

/** Индекс «имя → фича» с fail-fast на одноимённых разных фичах */
function indexByName(known: readonly Feature[]): Map<string, Feature> {
  const index = new Map<string, Feature>();

  for (const feature of known) {
    const existing = index.get(feature.name);

    if (existing && existing !== feature) {
      throw new Error(
        `Two different features are named '${feature.name}'. ` +
          `Feature names are the selection vocabulary, so they must be unique.`,
      );
    }

    index.set(feature.name, feature);
  }

  return index;
}

/** Разбирает `select` в список имён; форму-строку режет по запятой */
function readNames(select: FeatureSelection): string[] {
  const names = Array.isArray(select)
    ? [...(select as readonly string[])]
    : String(select).split(',');

  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

/**
 * Резолвит выбор фич: имена → значения, замкнутые по `dependsOn`.
 *
 * Все проверки — fail-fast на фазе ASSEMBLE, до построения контейнера.
 *
 * @param features - Фичи, перечисленные в корне
 * @param select - Форма выбора; отсутствует — выбраны все
 * @returns Выбранные фичи в детерминированном порядке
 *
 * @throws {Error} Неизвестное имя, одноимённые фичи, пустой выбор или
 * `select` без `features`
 */
export function resolveSelection(
  features: readonly Feature[] | undefined,
  select?: FeatureSelection,
): Feature[] {
  if (!features || features.length === 0) {
    if (select !== undefined) {
      throw new Error(
        `'select' is given, but no features are declared. ` +
          `Declare them in 'features:' of assemble({ … }) or drop 'select'.`,
      );
    }

    return [];
  }

  const known = reachable(features);
  const byName = indexByName(known);

  if (select === undefined || select === 'all') {
    return known;
  }

  const names = readNames(select);

  if (names.length === 0) {
    throw new Error(
      `'select' is empty. "Nothing" is written by declaring no features at ` +
        `all, not by an empty selection.`,
    );
  }

  const chosen: Feature[] = [];
  for (const name of names) {
    const feature = byName.get(name);

    if (!feature) {
      throw new Error(
        `Unknown feature '${name}' in 'select'. ` +
          `Available features: ${[...byName.keys()].join(', ')}.`,
      );
    }

    chosen.push(feature);
  }

  // Транзитивные зависимости выбранных приезжают сами
  return reachable(chosen);
}

/**
 * Модули выбранных фич в порядке выбора, дедуплицированные по имени.
 *
 * Дедупликация здесь — та же, что делает `ContainerBuilder`: смысл в том,
 * чтобы порядок регистрации был детерминированным.
 */
export function modulesOf(features: readonly Feature[]): Module[] {
  const seen = new Set<string>();
  const modules: Module[] = [];

  for (const feature of features) {
    for (const module of feature.modules) {
      if (seen.has(module.name)) {
        continue;
      }
      seen.add(module.name);
      modules.push(module);
    }
  }

  return modules;
}
