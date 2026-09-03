/**
 * Шов тестового корня: тот же `AssembledApp`, остановленный на фазе 3 WIRE.
 *
 * Живёт conditional subpath'ом `@nestling/app/testing` — условие
 * `"testing"` включено только в тест-раннере, поэтому прод-импорт не
 * резолвится **на уровне Node**, а не по договорённости. Это та же граница,
 * которую §5 design-дока предписывает пользовательским модулям; ядро её
 * догфудит, потому что предлагать пользователю конвенцию, которой сам не
 * следуешь, нечестно.
 *
 * Наружу шов отдаёт ровно одно: прохождение фаз 0–3 по декларации
 * `makeApp` с подстановками и доступ к контейнеру, карте endpoint'ов и
 * общему `AbortController`. Всё остальное — дело `@nestling/testing`.
 */

import type { App } from '../app.js';
import { AssembledApp, isApp } from '../app.js';
import type { FeatureSelection } from '../feature.js';
import type { TestSubstitutions, WiredApp } from '../plan.js';
import { makePlan, TEST_SEAM } from '../plan.js';

export type { TestSubstitutions, WiredApp, WiredEndpoint } from '../plan.js';

/**
 * Опции тестового прогона: выбор фич и подстановки.
 *
 * Состав приложения берётся из декларации; полей состава здесь нет.
 */
export interface WireOptions extends TestSubstitutions {
  /** Выбор фич — тот же, что в бою: опечатка падает на фазе ASSEMBLE */
  select?: FeatureSelection;
}

/**
 * Проводит приложение по фазам `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE`
 * и останавливается.
 *
 * Те же fail-fast'ы ASSEMBLE, что и в бою: сверка требуемых транспортов,
 * проверка форм io против их способностей, ацикличность графа, политики
 * декларации. START не выполняется — ни `@OnStart`, ни `serve`, ни
 * обработчики сигналов процесса, ни строка состава в stdout.
 *
 * @param app - Декларация приложения (`makeApp`)
 * @param options - Выбор фич, `overrides`/`familyOverrides`, провайдеры
 * стабов и привязка конфига теста
 * @returns Приложение, остановленное после WIRE
 * @throws {TypeError} Если первый аргумент — не декларация `makeApp`
 *
 * @example
 * ```typescript
 * const wired = await wireApp(app, {
 *   overrides: [[UsersRepository, inMemoryUsersRepo()]],
 * });
 * ```
 */
export async function wireApp(
  app: App,
  options: WireOptions = {},
): Promise<WiredApp> {
  if (!isApp(app)) {
    throw new TypeError(
      'wireApp(app, options): the first argument must be an application ' +
        'declaration created by makeApp({ … }).',
    );
  }

  const { select, ...substitutions } = options;
  const assembled = new AssembledApp(makePlan(app.spec, select, substitutions));

  return await assembled[TEST_SEAM]();
}
