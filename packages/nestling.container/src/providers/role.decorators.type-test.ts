/**
 * Типовые проверки декораторов роли, которые нельзя выполнить в рантайме.
 *
 * Файл не гоняется jest'ом: он и есть тест — если ошибка компиляции
 * исчезнет, `tsc` сообщит о неиспользованной директиве `@ts-expect-error`.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { makeToken } from '../tokens.js';

import { Component } from './role.decorators.js';

interface ILogger {
  log(message: string): void;
}

const Logger$ = makeToken<ILogger>('TypeTestLogger');

/** Формы декоратора с DI-токеном не существует: у него один аргумент */
// @ts-expect-error у декоратора роли одна форма — список зависимостей
@Component(Logger$, [])
class WithToken {}
