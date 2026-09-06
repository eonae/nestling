/**
 * Граница фичи: карта «модуль → владелец» и проверка рёбер графа.
 *
 * Правило одно и следует из критерия ролей: токен границу процесса не
 * переживает, а операция переживает. Значит, к фиче — только операциями, к
 * плагину — токенами.
 *
 * Механизм тот же, что был у проверки экспортов: обход собранного графа с
 * чтением метки узла. Карта другая — не «узел → модуль», а «модуль →
 * фича-владелец», и выводится она из состава.
 */

import type { Feature, Plugin } from './feature.js';
import { reachableModules } from './feature.js';

import type { BuiltContainer } from '@nestling/container';

/** Владелец модуля: единица, из состава которой он достижим */
export interface ModuleOwner {
  /** Имя фичи или плагина */
  readonly name: string;

  /** Роль владельца */
  readonly role: 'feature' | 'plugin';
}

/** Карта «имя модуля → его владелец» */
export type OwnerMap = ReadonlyMap<string, ModuleOwner>;

/**
 * Строит карту «модуль → фича-владелец» из состава приложения.
 *
 * Плагин владеет модулем сильнее фичи: он есть в каждом процессе, поэтому
 * ребро в его модуль законно из любой единицы. Модуль, достижимый из двух
 * фич, владельца не имеет — и это ошибка сборки: ребро в такой модуль
 * невозможно классифицировать, пока не решено, чья он часть.
 *
 * @param features - Выбранные фичи
 * @param plugins - Подключённые плагины
 * @returns Карта владельцев
 * @throws {Error} Если модуль достижим из двух и более фич
 */
export function buildOwnerMap(
  features: readonly Feature[],
  plugins: readonly Plugin[],
): OwnerMap {
  const owners = new Map<string, ModuleOwner>();

  for (const plugin of plugins) {
    for (const module of reachableModules(plugin)) {
      owners.set(module.name, { name: plugin.name, role: 'plugin' });
    }

    // Единица без состава всё равно владеет узлами: класс-хендлер
    // регистрируется под её именем
    if (!owners.has(plugin.name)) {
      owners.set(plugin.name, { name: plugin.name, role: 'plugin' });
    }
  }

  for (const feature of features) {
    if (!owners.has(feature.name)) {
      owners.set(feature.name, { name: feature.name, role: 'feature' });
    }

    for (const module of reachableModules(feature)) {
      const owner = owners.get(module.name);

      if (owner?.role === 'plugin') {
        continue;
      }

      if (owner && owner.name !== feature.name) {
        throw new Error(
          `Module '${module.name}' is reachable from two features, ` +
            `'${owner.name}' and '${feature.name}', so it has no single ` +
            `owner and an edge into it cannot be classified. A unit shared ` +
            `by two features is infrastructure: declare it with makePlugin ` +
            `and list it in 'plugins:' of makeApp({ … }).`,
        );
      }

      owners.set(module.name, { name: feature.name, role: 'feature' });
    }
  }

  return owners;
}

/** Текст ошибки о ребре между фичами */
const crossFeatureMessage = (
  from: string,
  to: string,
  consumer: string,
  dependency: string,
): string =>
  `Feature '${from}' depends on feature '${to}' by token: ` +
  `'${consumer}' injects '${dependency}'. Features are connected by ` +
  `operations only — a token does not survive a process boundary, so this ` +
  `edge breaks the moment the two features are deployed apart. Declare the ` +
  `call as an operation (makeRequest / makeCommand), inject its '.caller' ` +
  `and implement it in '${to}'.`;

/** Текст ошибки о ребре из плагина в фичу */
const pluginToFeatureMessage = (
  from: string,
  to: string,
  consumer: string,
  dependency: string,
): string =>
  `Plugin '${from}' depends on feature '${to}': ` +
  `'${consumer}' injects '${dependency}'. Infrastructure that knows about ` +
  `business logic can be neither reused nor shipped separately, and it stops ` +
  `assembling as soon as '${to}' is not selected. Take the value as a ` +
  `parameter of the plugin, or inject a token the plugin declares itself.`;

/**
 * Проверяет рёбра собранного графа против карты владельцев.
 *
 * Узел без метки модуля (kernel-провайдеры, провайдеры корня, агрегаты
 * семейств) владельца не имеет: рёбра к нему и от него не ограничены.
 *
 * Нарушения собираются все сразу: чинить границу по одному ребру за
 * перезапуск — не режим работы.
 *
 * @param container - Собранный контейнер
 * @param owners - Карта «модуль → владелец»
 * @throws {Error} Если найдено хотя бы одно запрещённое ребро
 */
export async function assertFeatureBoundary(
  container: BuiltContainer,
  owners: OwnerMap,
): Promise<void> {
  const violations: string[] = [];

  await container.traverse((node) => {
    const consumer = node.metadata.module;
    const from = consumer === undefined ? undefined : owners.get(consumer);

    if (!from) {
      return;
    }

    for (const dependency of node.dependencies) {
      const provider = dependency.metadata.module;
      const to = provider === undefined ? undefined : owners.get(provider);

      if (!to || to.name === from.name || to.role === 'plugin') {
        continue;
      }

      // Сюда доходят только рёбра в фичу: ребро в плагин отсеяно выше
      violations.push(
        from.role === 'feature'
          ? crossFeatureMessage(from.name, to.name, node.id, dependency.id)
          : pluginToFeatureMessage(from.name, to.name, node.id, dependency.id),
      );
    }
  });

  if (violations.length === 0) {
    return;
  }

  throw new Error(
    `${violations.length} edge(s) cross a feature boundary:\n\n` +
      violations.map((line) => `  - ${line}`).join('\n\n'),
  );
}
