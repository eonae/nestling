/**
 * Типовые тесты досрочного успеха.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета.
 *
 * Главный случай здесь — отсутствующая проверка. Декларация с `output` и
 * слоем досрочного успеха **компилируется**, а падает при создании
 * значения. Признак в типе означал бы пятый тип-параметр `Pipeline`,
 * размноженный по перегрузкам `compose`, а бюджет типов — измеренный
 * порог (`type-tests/BUDGET.md`: 250 000 инстанциаций на графе 50 × 50).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { makeEndpoint } from '../metadata/endpoint.js';

import { done } from './done.js';
import { compose, declaresDone, makePipeline } from './pipeline.js';

import { makeToken } from '@nestlingjs/container';
import { makeFail, Ok } from '@nestlingjs/operations';
import { z } from 'zod';

const TestTransport$ = makeToken('transport:test');

const Rejected = makeFail('bad_request:done_type_test', {
  message: 'Rejected',
});

/** Юнит возвращает досрочный успех вместо добавки */
const claiming = makePipeline().pre(() => done(), { done: true });

/** Досрочный успех в `input` не попадает: добавки у такого юнита нет */
const accumulated = makePipeline()
  .pre(() => ({ tenant: 'acme' }))
  .pre(() => done(), { done: true })
  .pre((ctx: { input: { tenant: string } }) => ({
    scope: ctx.input.tenant,
  }));

/** Признак читается значением, а не типом */
const flag: boolean = declaresDone(claiming);

/** Отказы и досрочный успех объявляются одним словарём */
const both = makePipeline().pre(() => done(), {
  errors: [Rejected],
  done: true,
});

/** Композиция слоёв с признаком и без него компилируется как обычно */
const guarded = compose(
  makePipeline().pre(() => ({ tx: 1 })),
  claiming,
);

/**
 * Декларация с `output` и слоем досрочного успеха компилятору видна
 * корректной. Ошибку даёт создание значения: `@ts-expect-error` здесь
 * был бы неиспользованной директивой.
 */
const compilesButThrows = () =>
  makeEndpoint({
    transport: TestTransport$,
    pattern: 'POST /type-test',
    output: z.object({ id: z.string() }),
    pipeline: claiming,
    handler: async () => new Ok({ id: '1' }),
  });
