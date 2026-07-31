/**
 * Контракт-форма `httpEndpoint`: вторая сторона одного значения.
 *
 * Проверяется, что декларация получается **обычной** (тот же бренд, тот же
 * транспорт, тот же паттерн), что карта берётся с контракта тем же значением
 * и что переобъявление интерфейса операции не проходит — ни типами, ни
 * рантаймом.
 */

import { httpBindingOf, query } from './binding.js';
import { httpEndpoint } from './helpers.js';
import { HttpTransport$ } from './token.js';

import { describe, expect, it } from '@jest/globals';
import { makeToken } from '@nestling/container';
import { defineFail, makeContract } from '@nestling/contracts';
import { isEndpointDefinition, Ok } from '@nestling/pipeline';
import { z } from 'zod';

const CreateUserInput = z.object({
  email: z.string(),
  dryRun: z.boolean().optional(),
});
const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = defineFail('CONTRACT_FORM_EMAIL_TAKEN', {
  status: 'CONFLICT',
  message: 'Email already taken',
});

const CreateUser = makeContract({
  name: 'contract-form.users.create',
  kind: 'request',
  http: { method: 'POST', path: '/users', bind: { dryRun: query() } },
  input: CreateUserInput,
  output: User,
  errors: [EmailTaken],
});

const GetUser = makeContract({
  name: 'contract-form.users.get',
  kind: 'request',
  http: 'GET /users/:id',
  input: z.object({ id: z.string() }),
  output: User,
});

/** Контракт без HTTP-адреса: он живёт только на шине */
const ClaimQuota = makeContract({
  name: 'contract-form.quotas.claim',
  kind: 'request',
  input: z.object({ tenant: z.string() }),
  output: z.object({ granted: z.boolean() }),
});

const UserService = makeToken<{ create: (email: string) => string }>(
  'ContractFormUserService',
);

describe('httpEndpoint({ contract, … })', () => {
  it('строит обычную HTTP-декларацию по адресу контракта', () => {
    const declaration = httpEndpoint({
      contract: CreateUser,
      handle: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(isEndpointDefinition(declaration)).toBe(true);
    expect(declaration.transport).toBe(HttpTransport$);
    expect(declaration.pattern).toBe('POST /users');
  });

  it('карта не пересчитывается — на декларации то же значение', () => {
    const declaration = httpEndpoint({
      contract: CreateUser,
      handle: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(declaration.binding).toBe(CreateUser.http);
    expect(httpBindingOf(declaration)).toBe(CreateUser.http);
  });

  it('схемы и errors: берутся с контракта', () => {
    const declaration = httpEndpoint({
      contract: CreateUser,
      handle: async ({ email }) => new Ok({ id: 'u-1', email }),
    });

    expect(declaration.input).toBe(CreateUserInput);
    expect(declaration.output).toBe(User);
    expect(declaration.errors).toEqual([EmailTaken]);
  });

  it('работают все три формы хендлера', () => {
    const asFunction = httpEndpoint({
      contract: GetUser,
      handle: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    const asFactory = httpEndpoint({
      contract: CreateUser,
      deps: [UserService],
      handle:
        (users) =>
        async ({ email }) =>
          new Ok({ id: users.create(email), email }),
    });

    class CreateUserHandler {
      async handle({ email }: { email: string }) {
        return new Ok({ id: 'u-2', email });
      }
    }

    const asClass = httpEndpoint({
      contract: CreateUser,
      handle: CreateUserHandler,
    });

    expect(asFunction.pattern).toBe('GET /users/:id');
    expect(asFactory.deps).toEqual([UserService]);
    expect(typeof asClass.resolve).toBe('function');
  });

  it('detached доезжает до декларации как у любой другой', () => {
    const declaration = httpEndpoint({
      contract: GetUser,
      detached: 'legacy route, migrated separately',
      handle: async ({ id }) => new Ok({ id, email: 'a@b.c' }),
    });

    expect(declaration.detached).toBe('legacy route, migrated separately');
  });

  it('контракт без http: отвергается в момент создания декларации', () => {
    expect(() =>
      httpEndpoint({
        contract: ClaimQuota,
        handle: async () => new Ok({ granted: true }),
      }),
    ).toThrow(
      /contract-form\.quotas\.claim.*no 'http:' section.*implement\(contract-form\.quotas\.claim/s,
    );
  });

  it('не-контракт в слоте отвергается', () => {
    const declare = httpEndpoint as unknown as (
      options: Record<string, unknown>,
    ) => unknown;

    expect(() =>
      declare({
        contract: { name: 'looks-like' },
        handle: async () => new Ok({}),
      }),
    ).toThrow(/'contract' must be a contract value created by makeContract/);
  });

  it('переобъявление интерфейса отвергается и рантаймом', () => {
    const declare = httpEndpoint as unknown as (
      options: Record<string, unknown>,
    ) => unknown;

    for (const field of ['input', 'output', 'errors', 'method', 'path']) {
      expect(() =>
        declare({
          contract: CreateUser,
          [field]: 'whatever',
          handle: async () => new Ok({ id: 'u-1', email: 'a@b.c' }),
        }),
      ).toThrow(
        new RegExp(
          `'${field}' belongs to the contract and cannot be redeclared`,
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
    contract: CreateUser,
    input: z.object({ other: z.string() }),
    // @ts-expect-error: 'input' принадлежит контракту; ошибка садится на
    // последний аргумент — элаборация последней перегрузки
    handle: create,
  });

  httpEndpoint({
    contract: GetUser,
    path: '/other',
    // @ts-expect-error: 'path' принадлежит контракту
    handle: read,
  });

  httpEndpoint({
    contract: CreateUser,
    // @ts-expect-error: 'errors' принадлежит контракту
    errors: [EmailTaken],
    // @ts-expect-error: элаборация последней перегрузки садится и сюда
    handle: create,
  });

  httpEndpoint({
    contract: CreateUser,
    bind: { dryRun: query() },
    // @ts-expect-error: 'bind' принадлежит контракту
    handle: create,
  });
};

describe('контракт-форма: типы', () => {
  it('переобъявление интерфейса не компилируется', () => {
    expect(typeof typeOnly).toBe('function');
  });

  it('payload и возврат хендлера выведены из контракта', () => {
    httpEndpoint({
      contract: CreateUser,
      handle: async (input) => {
        // Тип payload — из формы `input` контракта
        const email: string = input.email;
        return new Ok({ id: 'u-1', email });
      },
    });

    httpEndpoint({
      contract: CreateUser,
      // Отказ из `errors:` контракта — легальный возврат
      handle: async () => EmailTaken(),
    });

    expect(true).toBe(true);
  });
});
