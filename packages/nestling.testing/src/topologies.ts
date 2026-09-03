/**
 * `checkTopologies` — матрица `select`-топологий одним тестом.
 */

import type {
  App,
  CheckOptions,
  CheckReport,
  FeatureSelection,
} from '@nestling/app';
import { isApp } from '@nestling/app';

/** Отчёт одной топологии матрицы */
export interface TopologyReport {
  /** Значение `select`, с которым топология собиралась */
  readonly select: FeatureSelection;

  /** Состав, который вернул `check()` */
  readonly report: CheckReport;
}

/**
 * Прогоняет `app.check()` по каждой топологии из списка.
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
 * Отчёты матрицы пригодны для сведения в снапшот операций
 * (`snapshotOperations`) без пересборки приложения: дескрипторы уже лежат
 * в отчёте каждой топологии.
 *
 * @param app - Декларация приложения — та же, что у `main.ts`
 * @param selections - Варианты деплоя: `['all', 'users', 'ops']`
 * @param options - Опции `check()`; прокидываются в каждую топологию без
 * изменений. Вызов из двух аргументов ведёт себя ровно как прежде
 * @returns Отчёты по каждой топологии в порядке перечисления
 * @throws {TypeError} Если первый аргумент — не декларация `makeApp`
 * @throws {Error} Если хотя бы одна топология не собралась; в сообщении
 * названы все несобравшиеся с их причинами
 *
 * @example
 * ```typescript
 * const reports = await checkTopologies(app, ['all', 'users', 'ops'], {
 *   converters: [zodConverter()],
 * });
 * ```
 */
export async function checkTopologies(
  app: App,
  selections: readonly FeatureSelection[],
  options: CheckOptions = {},
): Promise<TopologyReport[]> {
  if (!isApp(app)) {
    throw new TypeError(
      'checkTopologies(app, selections): the first argument must be an ' +
        'application declaration created by makeApp({ … }).',
    );
  }

  const reports: TopologyReport[] = [];
  const failures: string[] = [];

  for (const select of selections) {
    try {
      reports.push({ select, report: await app.check(select, options) });
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
const describeSelection = (select: FeatureSelection): string => {
  if (typeof select === 'string') {
    return `'${select}'`;
  }

  return Array.isArray(select)
    ? `[${select.join(', ')}]`
    : JSON.stringify(select);
};
