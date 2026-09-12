/**
 * Фикстура: у класса без метода `handle` порядок списка зависимостей не
 * совпадает с порядком параметров конструктора.
 *
 * Это случай, ради которого заведена страховка от `any`. Ограничение
 * параметра декоратора класс не проходит, TypeScript печатает само
 * ограничение `new (...) => any`, и `any` в позиции экземпляра подходил
 * под форму хендлера: в тексте появлялось
 * `& RoleShapeError<"A class with a handle method is a handler, not a
 * component", "@Handler">` — утверждение о коде, и ложное.
 *
 * Снапшот обязан говорить только о несовпадении типов параметров.
 */

import { Component } from '@nestlingjs/container';

import { Database, Logger$ } from '../support/fixture-kit.js';

@Component([Logger$, Database])
export class UserService {
  constructor(
    private readonly db: Database,
    private readonly logger: { log(message: string): void },
  ) {}
}
