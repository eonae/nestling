/**
 * Шов тестового корня: тот же `App`, остановленный на фазе 3 WIRE.
 *
 * Живёт conditional subpath'ом `@nestling/app/testing` — условие
 * `"testing"` включено только в тест-раннере, поэтому прод-импорт не
 * резолвится **на уровне Node**, а не по договорённости. Это та же граница,
 * которую §5 design-дока предписывает пользовательским модулям; ядро её
 * догфудит, потому что предлагать пользователю конвенцию, которой сам не
 * следуешь, нечестно.
 *
 * Наружу шов отдаёт ровно две вещи: конструирование `App` с планом,
 * включающим подстановки, и прохождение фаз 0–3 с доступом к контейнеру,
 * карте ручек и общему `AbortController`. Всё остальное — дело
 * `@nestling/testing`.
 */

import { App } from '../app.js';
import type { AssemblySpec, TestSubstitutions, WiredApp } from '../plan.js';
import { makePlan, TEST_SEAM } from '../plan.js';

export type { TestSubstitutions, WiredApp, WiredEndpoint } from '../plan.js';

/** Словарь сборки тестового прогона: боевой плюс подстановки */
export type TestAssemblySpec = AssemblySpec & TestSubstitutions;

/**
 * Проводит приложение по фазам `0 BOOTSTRAP → 1 ASSEMBLE → 2 INIT → 3 WIRE`
 * и останавливается.
 *
 * Те же fail-fast'ы ASSEMBLE, что и в бою: сверка требуемых транспортов,
 * проверка форм io против их способностей, ацикличность графа. START не
 * выполняется — ни `@OnStart`, ни `serve`, ни обработчики сигналов
 * процесса, ни строка состава в stdout.
 *
 * @param spec - Словарь сборки плюс `overrides`/`familyOverrides`
 * @returns Приложение, остановленное после WIRE
 *
 * @example
 * ```typescript
 * const wired = await wireApp({
 *   features: [UsersFeature],
 *   transports: [http()],
 *   overrides: [[UsersRepository, inMemoryUsersRepo()]],
 * });
 * ```
 */
export async function wireApp(spec: TestAssemblySpec = {}): Promise<WiredApp> {
  const { overrides, familyOverrides, ...assembly } = spec;

  const app = new App(makePlan(assembly, { overrides, familyOverrides }));

  return await app[TEST_SEAM]();
}
