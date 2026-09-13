/**
 * Вклады `metrics:` выбранного состава — вход каталога фазы BUILD.
 *
 * Группу подключает фича, модуль или плагин, поэтому состав метрик
 * повторяет состав приложения: группы невыбранной фичи и невыбранной
 * ветки переключателя в каталог не попадают.
 */

import type { MetricsContribution } from '../metrics/index.js';

import type { ResolvedBundle } from './feature.js';
import { reachableModules } from './feature.js';

import type { AnySwitch, SwitchValues } from '@nestlingjs/container';
import { resolveBranches } from '@nestlingjs/container';

/** Имя владельца вклада для текстов отказов */
const ownerOf = (bundle: ResolvedBundle): string =>
  `${bundle.role} '${bundle.name}'`;

/**
 * Собирает вклады метрик выбранного состава.
 *
 * Модули обходятся вместе с их `dependsOn`: модуль-зависимость
 * регистрируется в графе, значит и его метрики принадлежат этой сборке.
 *
 * @param bundles - Единицы состава с раскрытыми списками
 * @param values - Значения переключателей фазы BUILD
 * @param missing - Ошибка на ветке переключателя вне `switches:`
 * @returns Вклады в порядке обхода состава
 */
export function collectMetrics(
  bundles: readonly ResolvedBundle[],
  values: SwitchValues,
  missing: (declared: AnySwitch) => Error,
): MetricsContribution[] {
  const contributions: MetricsContribution[] = [];

  for (const bundle of bundles) {
    for (const group of bundle.metrics) {
      contributions.push({ group, owner: ownerOf(bundle) });
    }

    for (const module of reachableModules(bundle, values)) {
      for (const group of resolveBranches(
        module.metrics ?? [],
        values,
        missing,
      )) {
        contributions.push({ group, owner: `module '${module.name}'` });
      }
    }
  }

  return contributions;
}
