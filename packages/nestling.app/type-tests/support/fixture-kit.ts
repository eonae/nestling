/**
 * Общий инвентарь фикстур: доменные типы и inline pre-юниты.
 *
 * Живёт вне `fixtures/`, потому что обязан компилироваться чисто —
 * диагностики отсюда в снапшоты не попадают.
 */

import type { AnyInput, PreUnitFn } from '@nestlingjs/app';

export interface User {
  id: string;
  name: string;
}

export const testUser: User = { id: '1', name: 'John Doe' };

/** Pre-юнит, добавляющий в input ровно указанные поля */
export function addField<T extends Record<string, unknown>>(
  value: T,
): PreUnitFn<AnyInput, T> {
  return async () => value;
}

/** Pre-юнит, требующий `identity` во входе и добавляющий указанные поля */
export function needsIdentity<T extends Record<string, unknown>>(
  value: T,
): PreUnitFn<{ identity: User }, T> {
  return async () => value;
}
