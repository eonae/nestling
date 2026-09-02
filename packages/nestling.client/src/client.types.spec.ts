/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради
 * рантайма */
/**
 * Типы call-site клиента.
 *
 * Обещание — «та же ветвящаяся логика, что написана для `.caller`, работает
 * без правок». Значит, проверять надо ровно это: множество результата
 * закрыто как `Ok<Output> | Fail<E ∪ UnknownError>`, предикат определения
 * сужает детали, а «забыл payload» — ошибка компиляции.
 */

import { makeClient } from './client.js';

import { describe, expect, it } from '@jest/globals';
import type { Fail, Ok } from '@nestling/operations';
import { defineFail, makeCommand, makeRequest } from '@nestling/operations';
import { z } from 'zod';

const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = defineFail('CLIENT_TYPES_EMAIL_TAKEN', {
  status: 'CONFLICT',
  message: 'Email already taken',
  details: z.object({ email: z.string() }),
});

const CreateUser = makeRequest({
  name: 'client.types.users.create',
  http: 'POST /users',
  input: z.object({ email: z.string() }),
  output: User,
  errors: [EmailTaken],
});

const Ping = makeRequest({
  name: 'client.types.ping',
  http: 'GET /ping',
  output: z.object({ pong: z.boolean() }),
});

const DeleteUser = makeCommand({
  name: 'client.types.users.delete',
  http: 'POST /users/delete',
  input: z.object({ id: z.string() }),
});

const api = makeClient(
  { createUser: CreateUser, ping: Ping, deleteUser: DeleteUser },
  { baseUrl: 'https://api.example.com' },
);

/** Тип совпадает с ожидаемым в обе стороны */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

const typeOnly = async (): Promise<void> => {
  const result = await api.createUser({ email: 'a@b.c' });

  // Множество результата закрыто: успех, объявленный отказ, `UnknownError`
  // и kernel-отказ бюджета — и ничего сверх того
  type Result = typeof result;
  type _Closed = Expect<
    Exact<
      Result,
      | Ok<{ id: string; email: string }>
      | (Fail<'CLIENT_TYPES_EMAIL_TAKEN', { email: string }> & {
          readonly details: { email: string };
        })
      | Fail<'UNKNOWN', undefined>
      | Fail<'DEADLINE_EXCEEDED', undefined>
    >
  >;

  // Предикат определения сужает детали — то же, что на call-site порта
  if (EmailTaken.is(result)) {
    const email: string = result.details.email;
  } else if (result.isFail) {
    // В ветке «не наш отказ» остаются успех и kernel-отказы
    const code: 'UNKNOWN' | 'DEADLINE_EXCEEDED' = result.code;
  } else {
    const id: string = result.value.id;
  }

  // Операция без формы `input` зовётся без payload'а
  await api.ping();

  // @ts-expect-error: payload обязателен — у операции есть форма `input`
  await api.createUser();

  // @ts-expect-error: 'email' объявлен строкой
  await api.createUser({ email: 42 });

  // Команда не возвращает значения
  type Command = Awaited<ReturnType<typeof api.deleteUser>>;
  type _Void = Expect<Exact<Command, void>>;
};

describe('client: типы call-site', () => {
  it('множество результата закрыто и сужается предикатом', () => {
    expect(typeof typeOnly).toBe('function');
  });
});
