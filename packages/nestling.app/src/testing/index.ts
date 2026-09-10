/**
 * Шов тестового корня: тот же `AssembledApp`, остановленный на фазе 3 WIRE.
 *
 * Живёт conditional subpath'ом `@nestlingjs/app/testing` — условие
 * `"testing"` включено только в тест-раннере, поэтому прод-импорт не
 * резолвится **на уровне Node**, а не по договорённости. Это та же граница,
 * которую §5 design-дока предписывает пользовательским модулям; ядро её
 * догфудит, потому что предлагать пользователю конвенцию, которой сам не
 * следуешь, нечестно.
 *
 * Наружу шов отдаёт ровно одно: прохождение фаз 0–3 по декларации
 * `makeApp` с подстановками и доступ к контейнеру, карте endpoint'ов и
 * общему `AbortController`. Всё остальное — дело `@nestlingjs/testing`.
 */

import type { App } from '../root/app.js';
import { AssembledApp, isApp } from '../root/app.js';
import type { AssembleArgs } from '../root/args.js';
import type { TestSubstitutions, WiredApp } from '../root/plan.js';
import { makePlan, TEST_SEAM } from '../root/plan.js';

import type { AnySwitch } from '@nestlingjs/container';

export type {
  TestSubstitutions,
  WiredApp,
  WiredEndpoint,
} from '../root/plan.js';

/**
 * Опции тестового прогона: аргумент сборки и подстановки.
 *
 * Состав приложения берётся из декларации; полей состава здесь нет.
 *
 * @template S - Переключатели декларации; из них выведен тип аргумента
 */
export interface WireOptions<
  S extends readonly AnySwitch[] = readonly AnySwitch[],
> extends TestSubstitutions {
  /**
   * Аргумент сборки — тот же, что в бою: опечатка падает на фазе
   * ASSEMBLE.
   */
  args?: AssembleArgs<S>;
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
 * @param options - Аргумент сборки, `overrides`/`familyOverrides`,
 * провайдеры стабов и привязка конфига теста
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
export async function wireApp<const S extends readonly AnySwitch[]>(
  app: App<S>,
  options: WireOptions<S> = {},
): Promise<WiredApp> {
  if (!isApp(app)) {
    throw new TypeError(
      'wireApp(app, options): the first argument must be an application ' +
        'declaration created by makeApp({ … }).',
    );
  }

  const { args, ...substitutions } = options;
  const assembled = new AssembledApp(makePlan(app.spec, args, substitutions));

  return await assembled[TEST_SEAM]();
}
