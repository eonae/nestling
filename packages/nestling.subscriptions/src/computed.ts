/**
 * Вычисляемый источник опции: значения переменных приходят аргументами.
 *
 * Форма повторяет `Var.provide(deps, compute)` ядра — список первым
 * аргументом, контекст первым параметром вычисления, значения следом.
 * Приложение называет **значения**, а форму накопленного `input` не
 * пересказывает ни аннотацией, ни приведением.
 */

import type {
  AnyContextVar,
  AnyInput,
  EmptyInput,
  ExtendableContext,
  ReadonlyContextVar,
} from '@nestlingjs/app';

/**
 * Значения списка переменных кортежем: тип каждого — из её объявления
 * плюс `undefined`.
 *
 * `undefined` здесь не перестраховка: значение кладёт пайплайн, и
 * переменной, которую не положил ни один шаг endpoint'а, в накопленном
 * входе нет. Тип без него заставил бы вычисление приводить значение
 * руками — то самое приведение, ради ухода от которого опция и принимает
 * переменную.
 *
 * Кортежный mapped type и ничего сложнее: конструкции вроде
 * `UnionToIntersection` считаются заново у каждого потребителя и уводят
 * пакет из бюджета типов.
 */
export type VarValues<V extends AnyContextVar[]> = {
  [I in keyof V]: V[I] extends ReadonlyContextVar<infer T>
    ? T | undefined
    : never;
};

/**
 * Значение переменной из накопленного входа.
 *
 * Единственное место пакета, где контекст приводится к форме с известным
 * `input`: снаружи функция-источник видит пустой вход, и прочитать его
 * мимо переменных ей нечем.
 *
 * @internal
 */
export const valueOfVar = (
  ctx: ExtendableContext<EmptyInput>,
  key: string,
): unknown => (ctx as ExtendableContext<AnyInput>).input[key];

/**
 * Собирает источник опции из нескольких контекстных переменных.
 *
 * Результат — обычная функция от контекста, поэтому годится в обе опции
 * модуля: и в `identity`, и в `labels`. Ключи переменных разбираются
 * один раз, при сборке источника.
 *
 * Значение переменной, которую пайплайн endpoint'а не положил, приходит
 * в `compute` как `undefined`: что вернуть в этом случае, решает
 * приложение.
 *
 * @param vars - Переменные, значения которых нужны вычислению
 * @param compute - Вычисление по контексту и значениям переменных
 * @returns Функция от контекста запроса
 *
 * @example
 * ```typescript
 * subscriptions({
 *   identity: computed([TenantId, UserId], (_ctx, tenant, user) =>
 *     `${tenant}:${user}`),
 * });
 * ```
 */
export function computed<const V extends readonly AnyContextVar[], T>(
  vars: V,
  compute: (
    ctx: ExtendableContext<EmptyInput>,
    ...values: VarValues<[...V]>
  ) => T,
): (ctx: ExtendableContext<EmptyInput>) => T {
  const keys = vars.map((variable) => variable.key);

  return (ctx) =>
    compute(
      ctx,
      ...(keys.map((key) => valueOfVar(ctx, key)) as VarValues<[...V]>),
    );
}
