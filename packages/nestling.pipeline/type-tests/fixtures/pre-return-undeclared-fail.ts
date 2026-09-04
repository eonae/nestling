/**
 * Фикстура: pre-юнит возвращает отказ, не объявленный во втором аргументе
 * `.pre`.
 *
 * Снапшот фиксирует читаемость литерала `__error`: сообщение обязано
 * называть незадекларированное определение в поле `undeclared`, а не
 * тонуть в раскрытии дженериков пайплайна.
 */

import { makeFail, makePipeline } from '@nestling/pipeline';

const Unauthorized = makeFail('unauthorized', { message: 'No token' });

const Forbidden = makeFail('forbidden', { message: 'Not yours' });

export const authed = makePipeline().pre(() => Forbidden(), {
  errors: [Unauthorized],
});
