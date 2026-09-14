/**
 * Каталог метрик: состав сборки и адреса рядов.
 *
 * Каталог собирается на фазе BUILD из вкладов `metrics:` выбранного
 * состава. Он знает про каждую метрику всё, что объявлено, и раздаёт
 * каждому заранее известному ряду индекс — поэтому запись становится
 * прибавкой по индексу, а экспозиция отдаёт нули до первой записи.
 */

import type { AnyMetricsGroup, MetricDeclaration } from './declaration.js';
import { metricName, open } from './declaration.js';
import type { MetricAttributes } from './snapshot.js';

/**
 * Вклад в каталог: группа и тот, кто её подключил.
 *
 * Владелец нужен тексту отказа на совпадение имён: автор чинит его в
 * `metrics:` конкретной единицы состава.
 */
export interface MetricsContribution {
  /** Подключённая группа */
  readonly group: AnyMetricsGroup;

  /** Имя фичи, модуля или плагина, объявившего вклад */
  readonly owner: string;
}

/**
 * Ряды, которые знает только сборка: полное имя метрики — её ряды.
 *
 * Этим пользуется ядро: значения `transport`, `pattern` и `operation`
 * приходят из деклараций сборки, и связаны они попарно, а не
 * произведением — endpoint `GET /users` есть только у своего транспорта.
 * Уточнить можно лишь метрику, объявившую хотя бы один атрибут `open`.
 */
export type SeriesResolutions = ReadonlyMap<
  string,
  readonly MetricAttributes[]
>;

/**
 * Дерево поиска ряда: значение атрибута — следующий уровень или индекс.
 *
 * Уровни идут в порядке объявления атрибутов, лист несёт индекс ряда.
 * Дерево, а не строковый ключ: запись ищет свой ряд по значениям
 * атрибутов, ничего не склеивая.
 *
 * @internal
 */
export type SeriesNode = Map<string, SeriesNode | number>;

/** Метрика в каталоге: объявленное плюс адреса её рядов */
export interface CatalogMetric {
  /** Полное имя: префикс группы и ключ записи */
  readonly name: string;

  /** Вид метрики */
  readonly kind: 'counter' | 'histogram';

  /** Описание из декларации */
  readonly help?: string;

  /** Единица измерения из декларации */
  readonly unit?: string;

  /** Границы корзин; только у гистограммы */
  readonly buckets?: readonly number[];

  /** Имена атрибутов в порядке объявления */
  readonly attributes: readonly string[];

  /** Заранее известные ряды в порядке индексов */
  readonly series: readonly MetricAttributes[];

  /** Индекс первого ряда в плоском хранилище своего вида */
  readonly base: number;

  /** Число заранее известных рядов */
  readonly width: number;

  /** Дерево поиска ряда по значениям атрибутов */
  readonly index: SeriesNode;

  /** Группа, объявившая метрику */
  readonly group: AnyMetricsGroup;

  /** Ключ метрики внутри группы */
  readonly key: string;
}

/** Каталог метрик сборки */
export interface MetricsCatalog {
  /** Метрики в порядке подключения групп */
  readonly metrics: readonly CatalogMetric[];

  /** Размер плоского хранилища счётчиков */
  readonly counters: number;

  /** Размер плоского хранилища гистограмм */
  readonly histograms: number;

  /**
   * Метрика по полному имени.
   *
   * @param name - Полное имя метрики
   */
  metric(name: string): CatalogMetric | undefined;

  /**
   * Метрики группы: ключ записи — метрика каталога.
   *
   * @param group - Подключённая группа
   */
  members(group: AnyMetricsGroup): ReadonlyMap<string, CatalogMetric>;
}

/** Перечни объявленных атрибутов или `undefined`, если хоть один открыт */
function declaredValues(
  declaration: MetricDeclaration,
): readonly (readonly string[])[] | undefined {
  const lists: (readonly string[])[] = [];

  for (const spec of Object.values(declaration.attributes)) {
    if (spec === open) {
      return undefined;
    }

    lists.push(spec as readonly string[]);
  }

  return lists;
}

/** Ряды как произведение перечней: правый атрибут меняется чаще всех */
function productSeries(
  names: readonly string[],
  lists: readonly (readonly string[])[],
): MetricAttributes[] {
  let series: MetricAttributes[] = [{}];

  for (const [position, values] of lists.entries()) {
    const name = names[position] as string;

    series = series.flatMap((row) =>
      values.map((value) => ({ ...row, [name]: value })),
    );
  }

  return series;
}

/** Проверяет ряд, пришедший от сборки: ключи те же, что объявлены */
function assertSeries(
  name: string,
  names: readonly string[],
  row: MetricAttributes,
): void {
  const keys = Object.keys(row);

  if (
    keys.length !== names.length ||
    names.some((attribute) => row[attribute] === undefined)
  ) {
    throw new Error(
      `The build resolves a series of metric '${name}' with attributes ` +
        `[${keys.join(', ')}], but the metric declares ` +
        `[${names.join(', ')}].`,
    );
  }
}

/** Строит дерево поиска: значения атрибутов ряда ведут к его индексу */
function buildIndex(
  metric: Pick<CatalogMetric, 'attributes' | 'base' | 'series'>,
): SeriesNode {
  const root: SeriesNode = new Map();

  for (const [offset, row] of metric.series.entries()) {
    let node = root;

    for (const [position, attribute] of metric.attributes.entries()) {
      const value = String(row[attribute]);

      if (position === metric.attributes.length - 1) {
        node.set(value, metric.base + offset);
        break;
      }

      let next = node.get(value) as SeriesNode | undefined;

      if (!next) {
        next = new Map();
        node.set(value, next);
      }

      node = next;
    }
  }

  return root;
}

/**
 * Собирает каталог метрик сборки.
 *
 * Одна и та же группа, подключённая двумя единицами, даёт один вклад:
 * группа опознаётся по ссылке. Совпадение полных имён у **разных** групп —
 * отказ сборки: иначе два ряда с одним именем несли бы разный смысл.
 *
 * @param contributions - Вклады `metrics:` выбранного состава
 * @param resolutions - Ряды, которые знает только сборка
 * @returns Каталог: состав метрик и адреса их рядов
 *
 * @throws {Error} Две группы объявили метрику с одним полным именем
 */
export function makeCatalog(
  contributions: readonly MetricsContribution[],
  resolutions: SeriesResolutions = new Map(),
): MetricsCatalog {
  const metrics: CatalogMetric[] = [];
  const byName = new Map<string, { metric: CatalogMetric; owner: string }>();
  const byGroup = new Map<AnyMetricsGroup, Map<string, CatalogMetric>>();

  let counters = 0;
  let histograms = 0;

  for (const { group, owner } of contributions) {
    if (byGroup.has(group)) {
      continue;
    }

    const members = new Map<string, CatalogMetric>();
    byGroup.set(group, members);

    for (const [key, declaration] of Object.entries(
      group.members as Record<string, MetricDeclaration>,
    )) {
      const name = metricName(group.prefix, key);
      const taken = byName.get(name);

      if (taken) {
        throw new Error(
          `Two metric groups declare '${name}': '${taken.metric.group.id}' ` +
            `(contributed by ${taken.owner}) and '${group.id}' (contributed ` +
            `by ${owner}). A metric name belongs to one group — change the ` +
            `prefix of one of them or the key of the metric.`,
        );
      }

      const names = Object.keys(declaration.attributes);
      const lists = declaredValues(declaration);
      const resolved = resolutions.get(name);

      if (resolved !== undefined && lists !== undefined) {
        throw new Error(
          `Metric '${name}' declares values for every attribute, so the ` +
            `build has nothing to resolve for it.`,
        );
      }

      const series =
        lists === undefined
          ? (resolved ?? [])
          : productSeries(names, lists as readonly (readonly string[])[]);

      for (const row of series) {
        assertSeries(name, names, row);
      }

      const base = declaration.kind === 'counter' ? counters : histograms;
      const metric: CatalogMetric = {
        name,
        kind: declaration.kind,
        ...(declaration.help === undefined ? {} : { help: declaration.help }),
        ...(declaration.unit === undefined ? {} : { unit: declaration.unit }),
        ...(declaration.kind === 'histogram'
          ? { buckets: declaration.buckets }
          : {}),
        attributes: names,
        series,
        base,
        width: series.length,
        index: buildIndex({ attributes: names, base, series }),
        group,
        key,
      };

      if (declaration.kind === 'counter') {
        counters += metric.width;
      } else {
        histograms += metric.width;
      }

      metrics.push(metric);
      members.set(key, metric);
      byName.set(name, { metric, owner });
    }
  }

  return {
    metrics,
    counters,
    histograms,
    metric: (name: string) => byName.get(name)?.metric,
    members: (group: AnyMetricsGroup) => byGroup.get(group) ?? new Map(),
  };
}

/**
 * Индекс ряда по атрибутам записи.
 *
 * `undefined` означает «ряд не заведён на сборке»: у метрики есть
 * открытый атрибут либо значение не входит в известные сборке ряды. Такой
 * ряд живёт в словаре store.
 *
 * @param metric - Метрика каталога
 * @param attributes - Атрибуты записи
 * @returns Индекс в плоском хранилище или `undefined`
 */
export function seriesIndex(
  metric: CatalogMetric,
  attributes: MetricAttributes,
): number | undefined {
  if (metric.width === 0) {
    return undefined;
  }

  // Метрика без атрибутов имеет ровно один ряд, и дерева у него нет
  if (metric.attributes.length === 0) {
    return metric.base;
  }

  let node: SeriesNode | number | undefined = metric.index;

  for (const attribute of metric.attributes) {
    if (typeof node === 'number' || node === undefined) {
      return undefined;
    }

    node = node.get(attributes[attribute] as string);
  }

  return typeof node === 'number' ? node : undefined;
}

/** Ключ ряда с открытыми атрибутами: значения в порядке объявления */
export function seriesKey(
  metric: CatalogMetric,
  attributes: MetricAttributes,
): string {
  let key = '';

  for (const attribute of metric.attributes) {
    key += ` ${String(attributes[attribute])}`;
  }

  return key;
}
