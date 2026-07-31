/**
 * `checkTopologies` — матрица `select`-топологий одним тестом.
 */

import type {
  AssemblySpec,
  CheckReport,
  FeatureSelection,
} from '@nestling/app';
import { assemble } from '@nestling/app';

/** Отчёт одной топологии матрицы */
export interface TopologyReport {
  /** Значение `select`, с которым топология собиралась */
  readonly select: FeatureSelection;

  /** Состав, который вернул `check()` */
  readonly report: CheckReport;
}

/**
 * Прогоняет `App.check()` по каждой топологии из списка.
 *
 * Разделение обязанностей намеренное: ядро фейлится быстро — первая же
 * несобираемая топология бросает свою ошибку, — а тестовый хелпер
 * рассказывает всю историю: собирает **все** отказы и падает одним
 * сообщением, называя топологию для каждого.
 *
 * Граф гоняется честный: `check()` не принимает подстановок, поэтому
 * матрица и компенсирует прунинг тестового корня. Правило для гайда одной
 * строкой: мокаешь — проверь топологию.
 *
 * @param spec - Тот же словарь сборки, что уедет в прод, без `select`
 * @param selections - Варианты деплоя: `['all', 'users', 'logging']`
 * @returns Отчёты по каждой топологии в порядке перечисления
 * @throws {Error} Если хотя бы одна топология не собралась; в сообщении
 * названы все несобравшиеся с их причинами
 *
 * @example
 * ```typescript
 * await checkTopologies(
 *   { features: [UsersFeature, LoggingFeature], transports: [http()] },
 *   ['all', 'users', 'logging'],
 * );
 * ```
 */
export async function checkTopologies(
  spec: AssemblySpec,
  selections: readonly FeatureSelection[],
): Promise<TopologyReport[]> {
  const reports: TopologyReport[] = [];
  const failures: string[] = [];

  for (const select of selections) {
    try {
      reports.push({
        select,
        report: await assemble({ ...spec, select }).check(),
      });
    } catch (error) {
      failures.push(
        `  - select: ${describeSelection(select)} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${selections.length} topologies did not ` +
        `assemble:\n${failures.join('\n')}`,
    );
  }

  return reports;
}

/** Читаемое имя топологии для сообщения об отказе */
const describeSelection = (select: FeatureSelection): string =>
  Array.isArray(select) ? `[${select.join(', ')}]` : `'${String(select)}'`;
