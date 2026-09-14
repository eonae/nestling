/* eslint-disable @typescript-eslint/no-unused-vars --
 * блок типовых проверок объявляет значения ради компилятора, не ради
 * рантайма */
/**
 * Типы call-site клиента.
 *
 * Обещание — «та же ветвящаяся логика, что написана для `.caller`, работает
 * без правок». Значит, проверять надо ровно это: множество результата
 * закрыто как `Ok<Output> | Fail<E ∪ InternalError>`, предикат определения
 * сужает детали, а «забыл payload» — ошибка компиляции.
 */

import { makeClient } from './client.js';

import type { Fail, Ok } from '@nestlingjs/operations';
import {
  makeCommand,
  makeFail,
  makeRequest,
  outputs,
} from '@nestlingjs/operations';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const User = z.object({ id: z.string(), email: z.string() });

const EmailTaken = makeFail('conflict:client_types_email_taken', {
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

/** Операция с развилкой: тип результата различает исходы дискриминантом */
const CreateJob = makeRequest({
  name: 'client.types.jobs.create',
  http: 'POST /jobs',
  output: outputs({ ok: User, accepted: z.object({ jobId: z.string() }) }),
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
  {
    createUser: CreateUser,
    createJob: CreateJob,
    ping: Ping,
    deleteUser: DeleteUser,
  },
  { baseUrl: 'https://api.example.com' },
);

/** Тип совпадает с ожидаемым в обе стороны */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

const typeOnly = async (): Promise<void> => {
  const result = await api.createUser({ email: 'a@b.c' });

  // Множество результата закрыто: успех, объявленный отказ, `InternalError`
  // и kernel-отказ бюджета — и ничего сверх того
  type Result = typeof result;
  type _Closed = Expect<
    Exact<
      Result,
      | Ok<{ id: string; email: string }>
      | (Fail<'conflict:client_types_email_taken', { email: string }> & {
          readonly details: { email: string };
        })
      | Fail<'internal_error', undefined>
      | Fail<'timeout', undefined>
    >
  >;

  // Предикат определения сужает детали — то же, что на call-site порта
  if (EmailTaken.is(result)) {
    const email: string = result.details.email;
  } else if (result.isFail) {
    // В ветке «не наш отказ» остаются успех и kernel-отказы
    const code: 'internal_error' | 'timeout' = result.code;
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

  // У развилки успешная половина — юнион `Ok` по статусам
  const job = await api.createJob();
  type JobResult = typeof job;
  type _Outcomes = Expect<
    Exact<
      Extract<JobResult, { isFail: false }>,
      | Ok<{ id: string; email: string }, 'ok'>
      | Ok<{ jobId: string }, 'accepted'>
    >
  >;

  // Проверка статуса сужает значение до формы своей ветки
  if (!job.isFail && job.status === 'accepted') {
    const jobId: string = job.value.jobId;
    void jobId;
  }
};

describe('client: типы call-site', () => {
  it('множество результата закрыто и сужается предикатом', () => {
    expect(typeof typeOnly).toBe('function');
  });
});
