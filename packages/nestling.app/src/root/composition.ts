/**
 * Фаза 0 BOOTSTRAP как чистая функция: состав приложения — значение.
 *
 * Аргумент сборки разбирается здесь, а не в двух похожих местах. Ту же
 * функцию зовут сборка (`AssembledApp`) и генератор документа
 * (`App.discover`), поэтому одинаковый состав у них — свойство одного
 * кода, а не совпадение.
 *
 * Ввода-вывода в модуле нет: источники конфига поднимает `#bootstrap`,
 * граф строит фаза 1.
 */

import type {
  ServerDeclaration,
  TransportDeclaration,
} from '../transport/index.js';
import { isTransport } from '../transport/index.js';

import type { AssembleArgs, ParsedArgs } from './args.js';
import { parseArgs, resolveSwitchValues, undeclaredSwitch } from './args.js';
import type { Bundle, Feature, ResolvedBundle } from './feature.js';
import {
  reachablePlugins,
  resolveBundle,
  resolveSelection,
} from './feature.js';
import type { NormalizedAppSpec } from './plan.js';
import { collectServers } from './plan.js';
import { closeOverCalls } from './selection.js';

import type { SwitchValues } from '@nestling/container';
import { resolveBranches } from '@nestling/container';

/**
 * Состав приложения при данном аргументе сборки.
 *
 * Всё, что фаза 0 знает о процессе: какие фичи выбраны, какие плагины
 * подключены, какие транспорты и серверы объявлены и с какими значениями
 * переключателей раскрыты ветки.
 */
export interface AppComposition {
  /** Значения переключателей этой сборки в порядке объявления */
  readonly switches: SwitchValues;

  /**
   * Фактический состав фич: выбор с раскрытыми ветками, замкнутый по
   * вызываемым операциям при `includeDeps`.
   */
  readonly features: readonly ResolvedBundle[];

  /**
   * Единица корня и плагины: они в сборке при любом выборе фич.
   *
   * Роль каждой единицы читается с неё самой — граница фич разделяет этот
   * список по `role`.
   */
  readonly alwaysOn: readonly ResolvedBundle[];

  /** Единицы сборки одним списком: выбранные фичи и всегда включённые */
  readonly bundles: readonly ResolvedBundle[];

  /** Имена фич, названных в выборе, — до замыкания по вызовам */
  readonly named: readonly string[];

  /** Замкнут ли выбор по вызываемым операциям */
  readonly includeDeps: boolean;

  /** Транспорты сборки после раскрытия веток */
  readonly transports: readonly TransportDeclaration[];

  /**
   * Серверы сборки после раскрытия веток, в порядке объявления.
   *
   * Собраны из элементов `transports:` и из полей `server` объявлений
   * транспортов, без повторов.
   */
  readonly servers: readonly ServerDeclaration[];
}

/**
 * Считает состав приложения по декларации и аргументу сборки.
 *
 * Порядок задан фазовой моделью: значения переключателей считаются
 * первыми, ветки раскрываются вторыми, замыкание по вызовам — последним.
 * Так замыкание видит уже выбранный состав: ветка может привезти
 * endpoint, который зовёт операцию соседней фичи.
 *
 * Функция чистая и синхронная: ни источников конфига, ни графа, ни
 * транспортов. Опечатка в имени фичи и значение вне словаря
 * переключателя падают здесь — раньше любого захвата ресурсов.
 *
 * @param spec - Нормализованная декларация приложения
 * @param args - Аргумент сборки; отсутствует — все фичи и умолчания
 * @returns Состав приложения: единицы, транспорты, серверы и значения
 * переключателей
 * @throws {TypeError} Неизвестное поле аргумента
 * @throws {Error} Неизвестное имя фичи, значение переключателя вне
 * словаря, ветка на необъявленном переключателе
 *
 * @internal
 */
export function resolveComposition(
  spec: NormalizedAppSpec,
  args?: AssembleArgs<any>,
): AppComposition {
  const parsed: ParsedArgs = parseArgs(args, spec.switches);
  const values = resolveSwitchValues(spec.switches, parsed);

  const resolve = (bundle: Bundle): ResolvedBundle =>
    resolveBundle(bundle, values, undeclaredSwitch);

  // Плагины замыкаются по `dependsOn` уже после раскрытия: ветка в
  // `plugins:` корня может привезти плагин со своими зависимостями
  const plugins = reachablePlugins(
    resolveBranches(spec.plugins, values, undeclaredSwitch),
  );

  const alwaysOn: readonly ResolvedBundle[] = [
    ...(spec.root ? [resolve(spec.root)] : []),
    ...plugins.map((plugin) => resolve(plugin)),
  ];

  // Транспорты и серверы разделяются здесь: до раскрытия веток состав
  // списка неизвестен
  const entries = resolveBranches(spec.transports, values, undeclaredSwitch);

  const selection = resolveSelection(
    spec.features,
    parsed.features,
    parsed.includeDeps,
  );

  // Раскрытие делается один раз на фичу и запоминается: discovery и
  // карта владельцев сверяют единицы по идентичности значения
  const resolved = new Map<Feature, ResolvedBundle>();
  const of = (feature: Feature): ResolvedBundle => {
    const known = resolved.get(feature);

    if (known) {
      return known;
    }

    const fresh = resolve(feature);
    resolved.set(feature, fresh);

    return fresh;
  };

  const selected = selection.features.map((feature) => of(feature));

  const features = selection.includeDeps
    ? closeOverCalls(
        selected,
        new Map(
          [...selection.declared].map(([name, feature]) => [name, of(feature)]),
        ),
        values,
      )
    : selected;

  return {
    switches: values,
    features,
    alwaysOn,
    bundles: [...features, ...alwaysOn],
    named: selected.map((feature) => feature.name),
    includeDeps: selection.includeDeps,
    transports: entries.filter(isTransport),
    servers: collectServers(entries),
  };
}
