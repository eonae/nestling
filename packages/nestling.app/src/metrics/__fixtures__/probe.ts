/**
 * Store и писатели для спек пакета: каталог собирается прямо из групп.
 *
 * Спека рантайма не поднимает приложение, поэтому каталог и store здесь
 * создаются руками — так же, как их создаёт фаза BUILD.
 */

import type { MetricsContribution, SeriesResolutions } from '../catalog.js';
import { makeCatalog } from '../catalog.js';
import type { AnyMember, AnyMetricsGroup, MetricsOf } from '../declaration.js';
import type {
  KernelMetricsWriter,
  MetricEndpoint,
  MetricOperation,
} from '../kernel-group.js';
import { KernelMetrics, kernelSeries } from '../kernel-group.js';
import { findSeries, findSeriesOne } from '../lookup.js';
import type { MetricAttributes, MetricSeries } from '../snapshot.js';
import { MetricsStore } from '../store.js';
import { makeWriter } from '../writer.js';

/** Состав пробы: группы приложения и декларации сборки */
export interface ProbeOptions {
  /** Группы приложения; группа ядра подключена всегда */
  readonly groups?: readonly AnyMetricsGroup[];

  /** Endpoint'ы, по которым заводятся ряды метрик запроса */
  readonly endpoints?: readonly MetricEndpoint[];

  /** Операции, по которым заводятся ряды метрик порта */
  readonly operations?: readonly MetricOperation[];
}

/** Store спеки и доступ к его рядам */
export interface MetricsProbe {
  /** Store с каталогом пробы */
  readonly store: MetricsStore;

  /** Писатель группы ядра */
  readonly kernel: KernelMetricsWriter;

  /** Писатель группы приложения */
  writer<G extends AnyMetricsGroup>(group: G): MetricsOf<G>;

  /** Единственный ряд метрики по атрибутам */
  of(
    member: AnyMember,
    attributes?: MetricAttributes,
  ): MetricSeries | undefined;

  /** Все ряды метрики по атрибутам */
  all(
    member: AnyMember,
    attributes?: MetricAttributes,
  ): readonly MetricSeries[];
}

/**
 * Создаёт store с каталогом из перечисленных групп.
 *
 * @param options - Группы приложения и декларации сборки
 * @returns Store, писателей и доступ к рядам снимка
 */
export function probeMetrics(options: ProbeOptions = {}): MetricsProbe {
  const contributions: MetricsContribution[] = [
    { group: KernelMetrics, owner: "kernel module 'kernel:metrics'" },
    ...(options.groups ?? []).map((group) => ({
      group,
      owner: "feature 'spec'",
    })),
  ];

  const resolutions: SeriesResolutions = kernelSeries(
    options.endpoints ?? [],
    options.operations ?? [],
  );

  const store = new MetricsStore(makeCatalog(contributions, resolutions));

  return {
    store,
    kernel: makeWriter(KernelMetrics, store),
    writer: <G extends AnyMetricsGroup>(group: G) => makeWriter(group, store),
    of: (member, attributes) =>
      findSeriesOne(store.snapshot(), member, attributes),
    all: (member, attributes) =>
      findSeries(store.snapshot(), member, attributes),
  };
}
