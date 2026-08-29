/**
 * Подстановки тестового корня: пары `токен → фейк` и подмена рецепта
 * семейства — одним списком.
 */

import type {
  FamilyOverrideEntry,
  InjectionToken,
  TokenFamily,
  TokenOverride,
} from '@nestling/container';
import { valueProvider } from '@nestling/container';

/**
 * Элемент списка `overrides:`: пара либо подмена рецепта семейства.
 *
 * Одним списком, а не двумя полями: с точки зрения теста это одно и то же
 * решение — «здесь боевого кода не будет».
 */
export type TestOverride = TokenOverride<any> | FamilyOverrideEntry<any, any>;

/**
 * Типизация списка `overrides:`.
 *
 * Для каждой пары `[Token, fake]` требует, чтобы фейк был совместим с типом
 * токена: подмена не того типа — ошибка компиляции, а не рантайм-сюрприз.
 * Значения `familyOverride(...)` проходят как есть — их типизирует сама
 * функция.
 */
export type ValidatedOverrides<L> = {
  [K in keyof L]: L[K] extends FamilyOverrideEntry<any, any>
    ? L[K]
    : L[K] extends readonly [infer Token, unknown]
      ? Token extends InjectionToken<infer Value>
        ? readonly [Token, Value]
        : never
      : never;
};

/** Значение — подмена рецепта семейства, а не пара `токен → фейк`? */
export const isFamilyOverride = (
  value: unknown,
): value is FamilyOverrideEntry<any, any> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  'family' in value &&
  'recipe' in value;

/**
 * Подменяет рецепт целого семейства.
 *
 * Единственный способ выразить cross-cutting: `familyOverride(ILogger, () =>
 * noop)` делает no-op'ом каждый инжект `ILogger('users')`,
 * `ILogger('orders')` и любой другой — включая члены, о существовании
 * которых тест не знает. Подмена применяется **до** создания узла графа,
 * поэтому боевой рецепт не вызывается ни разу.
 *
 * @param family - Семейство, созданное `makeTokenFamily`
 * @param make - Значение члена по его параметру
 * @returns Значение для списка `overrides:`
 *
 * @example
 * ```typescript
 * await using app = await assembleTest({
 *   features: [UsersFeature],
 *   overrides: [familyOverride(ILogger, () => noopLogger)],
 * });
 * ```
 */
export function familyOverride<T, Params extends [param: string]>(
  family: TokenFamily<T, Params>,
  make: (...params: Params) => T,
): FamilyOverrideEntry<T, Params> {
  return {
    family,
    recipe: (...params: Params) =>
      valueProvider(family(...params), make(...params)),
  };
}

/** Разбирает общий список на две формы, которые понимает контейнер */
export const splitOverrides = (
  overrides: readonly TestOverride[] = [],
): {
  tokens: TokenOverride<any>[];
  families: FamilyOverrideEntry<any, any>[];
} => {
  const tokens: TokenOverride<any>[] = [];
  const families: FamilyOverrideEntry<any, any>[] = [];

  for (const override of overrides) {
    if (isFamilyOverride(override)) {
      families.push(override);
    } else {
      tokens.push(override);
    }
  }

  return { tokens, families };
};
