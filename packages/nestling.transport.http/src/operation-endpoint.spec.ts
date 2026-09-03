/**
 * Операция-форма `httpEndpoint`: вторая сторона одного значения.
 *
 * Проверяется, что декларация получается **обычной** (тот же бренд, тот же
 * транспорт, тот же паттерн), что карта берётся с операции тем же значением
 * и что переобъявление интерфейса операции не проходит — ни типами, ни
 * рантаймом.
 */

import { httpBindingOf, query } from './binding.js';
import { httpEndpoint } from './helpers.js';
import { HttpTransport$ } from './token.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import { makeFail, makeRequest } from '@nestling/operations';
import {
  handlerDependenciesOf,
  isEndpointDefinition,
  Ok,
} from '@nestling/pipeline';
import { z } from 'zod';

const CreateUserInput = z.object({
  email: z.string(),
  dryRun: z.boolean().optional(),
});
const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = makeFail('conflict:operation_form_email_taken', {
  message: 'Email already taken',
});

const CreateUser = makeRequest({
  name: 'operation-form.users.create',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
});

const GetUser = makeRequest({
  name: 'operation-form.users.get',
  http: 'GET /users/:id',
  input: z.object({ id: z.string() }),
  output: User,
});

/** Операция без HTTP-адреса: он живёт только на шине */
const ClaimQuota = makeRequest({
  name: 'operation-form.quotas.claim',
  input: z.object({ tenant: z.string() }),
  output: z.object({ granted: z.boolean() }),
});

const UserService = makeToken<{ create: (email: string) => string }>(
  'OperationFormUserService',
);

describe('httpEndpoint({ operation, … })', () => {
  it('строит обычную HTTP-декларацию по адресу операции', () => {
    const declaration = httpEndpoint({
      operation: CreateUser,
      handler: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(isEndpointDefinition(declaration)).toBe(true);
    expect(declaration.transport).toBe(HttpTransport$('default'));
    expect(declaration.pattern).toBe('POST /users');
  });

  it('карта не пересчитывается — на декларации то же значение', () => {
    const declaration = httpEndpoint({
      operation: CreateUser,
      handler: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(declaration.binding).toBe(CreateUser.http);
    expect(httpBindingOf(declaration)).toBe(CreateUser.http);
  });

  it('схемы и errors: берутся с операции', () => {
    const declaration = httpEndpoint({
      operation: CreateUser,
      handler: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(declaration.input).toBe(CreateUserInput);
    expect(declaration.output).toBe(User);
    expect(declaration.errors).toEqual([EmailTaken]);
  });

  it('работают все три формы хендлера', () => {
    const asFunction = httpEndpoint({
      operation: GetUser,
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    const asFactory = httpEndpoint({
      operation: CreateUser,
      handler: {
        deps: [UserService],
        handle:
          (users) =>
          async ({ email }) =>
            new Ok({ id: users.create(email), email }),
      },
    });

    class CreateUserHandler {
      async handle({ email }: { email: string }) {
        return new Ok({ id: 'u-2', email });
      }
    }

    const asClass = httpEndpoint({
      operation: CreateUser,
      handler: CreateUserHandler,
    });

    expect(asFunction.pattern).toBe('GET /users/:id');
    expect(handlerDependenciesOf(asFactory)).toEqual([UserService]);
    expect(typeof asClass.resolve).toBe('function');
  });

  it('detached передаётся в декларацию, как у любой другой', () => {
    const declaration = httpEndpoint({
      operation: GetUser,
      detached: 'legacy route, migrated separately',
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(declaration.detached).toBe('legacy route, migrated separately');
  });

  it('операция без http: отвергается в момент создания декларации', () => {
    expect(() =>
      httpEndpoint({
        operation: ClaimQuota,
        handler: async () => new Ok({ granted: true }),
      }),
    ).toThrow(
      /operation-form\.quotas\.claim.*no 'http:' section.*implement\(operation-form\.quotas\.claim/s,
    );
  });

  it('документация приходит из операции вместе с адресом и схемами', () => {
    const Documented = makeRequest({
      name: 'operation-form.users.documented',
      http: 'GET /documented/:id',
      input: z.object({ id: z.string() }),
      output: User,
      doc: { summary: 'Documented operation', tags: ['users'] },
    });

    const declaration = httpEndpoint({
      operation: Documented,
      handler: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(declaration.doc).toEqual({
      summary: 'Documented operation',
      tags: ['users'],
    });
    // Имя владельца хранится на карте — из него генератор выводит operationId
    expect(httpBindingOf(declaration).operation).toBe(
      'operation-form.users.documented',
    );
  });

  it('не-операция в слоте отвергается', () => {
    const declare = httpEndpoint as unknown as (
      options: Record<string, unknown>,
    ) => unknown;

    expect(() =>
      declare({
        operation: { name: 'looks-like' },
        handle: async () => new Ok({}),
      }),
    ).toThrow(/'operation' must be a value created by makeRequest/);
  });

  it('переобъявление интерфейса отвергается и рантаймом', () => {
    const declare = httpEndpoint as unknown as (
      options: Record<string, unknown>,
    ) => unknown;

    for (const field of [
      'input',
      'output',
      'errors',
      'method',
      'path',
      'doc',
    ]) {
      expect(() =>
        declare({
          operation: CreateUser,
          [field]: 'whatever',
          handle: async () => new Ok({ id: 'u-1', email: 'a@b.c' }),
        }),
      ).toThrow(
        new RegExp(
          `'${field}' belongs to the operation and cannot be redeclared`,
        ),
      );
    }
  });
});

/**
 * Хендлер с явно типизированным параметром: перегрузок больше трёх, и при
 * неудачном резолвинге TypeScript элаборирует последнюю (класс-форму) —
 * контекстный тип параметра при этом теряется, и неявный `any` шумел бы
 * поверх проверяемой диагностики.
 */
const create = async (input: { email: string }) =>
  new Ok({ id: 'u-1', email: input.email });

const read = async (input: { id: string }) =>
  new Ok({ id: input.id, email: 'a@b.c' });

/**
 * Объявляется, но **не вызывается**: рантайм на этих словарях бросает
 * (та же проверка, что в блоке выше), а предмет проверки здесь — типы.
 */
const typeOnly = (): void => {
  httpEndpoint({
    operation: CreateUser,
    input: z.object({ other: z.string() }),
    // @ts-expect-error: 'input' принадлежит операции; ошибка садится на
    // последний аргумент — элаборация последней перегрузки
    handler: create,
  });

  httpEndpoint({
    operation: GetUser,
    path: '/other',
    // @ts-expect-error: 'path' принадлежит операции
    handler: read,
  });

  httpEndpoint({
    operation: CreateUser,
    // @ts-expect-error: 'errors' принадлежит операции
    errors: [EmailTaken],
    // @ts-expect-error: элаборация последней перегрузки садится и сюда
    handler: create,
  });

  httpEndpoint({
    operation: CreateUser,
    bind: { dryRun: query() },
    // @ts-expect-error: 'bind' принадлежит операции
    handler: create,
  });
};

describe('операция-форма: типы', () => {
  it('переобъявление интерфейса не компилируется', () => {
    expect(typeof typeOnly).toBe('function');
  });

  it('payload и возврат хендлера выведены из операции', () => {
    httpEndpoint({
      operation: CreateUser,
      handler: async (input) => {
        // Тип payload — из формы `input` операции
        const email: string = input.email;
        return new Ok({ id: 'u-1', email });
      },
    });

    httpEndpoint({
      operation: CreateUser,
      // Отказ из `errors:` операции — разрешённый возврат
      handler: async () => EmailTaken(),
    });

    expect(true).toBe(true);
  });
});
