/**
 * Общий инвентарь фикстур: DI-токены, на которые ссылаются объявления.
 *
 * Живёт вне `fixtures/`, потому что обязан компилироваться чисто —
 * диагностики отсюда в снапшоты не попадают. Устроен так же, как
 * `packages/nestling.transport.http/type-tests/support/fixture-kit.ts`.
 */

import { Component, makeToken } from '@nestlingjs/container';

/** Объектный DI-токен: вторая позиция в списке зависимостей фикстур */
export interface ILogger {
  log(message: string): void;
}

export const Logger$ = makeToken<ILogger>('Logger');

/** Класс-DI-токен: первая позиция в списке зависимостей фикстур */
@Component([])
export class Database {
  query(): string {
    return 'row';
  }
}
