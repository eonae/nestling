/**
 * `checkTopologies` — матрица топологий одним тестом.
 */

import type {
  App,
  AssembleArgs,
  CheckOptions,
  CheckReport,
} from '@nestlingjs/app';
import { isApp } from '@nestlingjs/app';
import type { AnySwitch } from '@nestlingjs/container';

/** Отчёт одной топологии матрицы */
export interface TopologyReport<
  S extends readonly AnySwitch[] = readonly AnySwitch[],
> {
  /** Аргумент сборки, с которым топология собиралась */
  readonly args: AssembleArgs<S>;

  /** Состав, который вернул `check()` */
  readonly report: CheckReport;
}

/**
 * Прогоняет `app.check()` по каждой топологии из списка.
 *
 * Топология описывается аргументом сборки целиком: выбором фич и
 * значениями переключателей вместе. Элемент списка — то же значение, что
 * принимает `app.assemble(args)`.
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
 * Опции прокидываются в каждую топологию без изменений — `config:` в том
 * числе: матрица с `config: vars({ … })` проверяет состав без единого
 * источника, а значит и без ввода-вывода.
 *
 * @param app - Декларация приложения — та же, что у `main.ts`
 * @param topologies - Варианты деплоя: `['all', 'users', { storage: 's3' }]`
 * @param options - Опции `check()`: конвертеры схем и конфиг проверки
 * @returns Отчёты по каждой топологии в порядке перечисления
 * @throws {TypeError} Если первый аргумент — не декларация `makeApp`
 * @throws {Error} Если хотя бы одна топология не собралась; в сообщении
 * названы все несобравшиеся с их причинами
 *
 * @example
 * ```typescript
 * const reports = await checkTopologies(
 *   app,
 *   ['all', 'users', { features: 'all', storage: 'local' }],
 *   { converters: [zodConverter()], config: vars({ ORDERS_MAX_ITEMS: '10' }) },
 * );
 * ```
 */
export async function checkTopologies<const S extends readonly AnySwitch[]>(
  app: App<S>,
  topologies: readonly AssembleArgs<S>[],
  options: CheckOptions = {},
): Promise<TopologyReport<S>[]> {
  if (!isApp(app)) {
    throw new TypeError(
      'checkTopologies(app, topologies): the first argument must be an ' +
        'application declaration created by makeApp({ … }).',
    );
  }

  const reports: TopologyReport<S>[] = [];
  const failures: string[] = [];

  for (const args of topologies) {
    try {
      reports.push({ args, report: await app.check(args, options) });
    } catch (error) {
      failures.push(
        `  - args: ${describeArgs(args)} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${topologies.length} topologies did not ` +
        `assemble:\n${failures.join('\n')}`,
    );
  }

  return reports;
}

/** Читаемое имя топологии для сообщения об отказе */
const describeArgs = (args: AssembleArgs<any>): string => {
  if (typeof args === 'string') {
    return `'${args}'`;
  }

  return Array.isArray(args) ? `[${args.join(', ')}]` : JSON.stringify(args);
};
