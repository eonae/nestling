/**
 * Общий инвентарь фикстур: доменные типы и inline pre-шаги.
 *
 * Живёт вне `fixtures/`, потому что обязан компилироваться чисто —
 * диагностики отсюда в снапшоты не попадают.
 */

import type { AnyInput, PreStepFn } from '@nestlingjs/app';

export interface User {
  id: string;
  name: string;
}

export const testUser: User = { id: '1', name: 'John Doe' };

/** Pre-шаг, добавляющий в input ровно указанные поля */
export function addField<T extends Record<string, unknown>>(
  value: T,
): PreStepFn<AnyInput, T> {
  return async () => value;
}

/** Pre-шаг, требующий `identity` во входе и добавляющий указанные поля */
export function needsIdentity<T extends Record<string, unknown>>(
  value: T,
): PreStepFn<{ identity: User }, T> {
  return async () => value;
}
