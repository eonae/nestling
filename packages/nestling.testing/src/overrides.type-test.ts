/**
 * Типовые тесты тестового корня (стиль — `TYPE-TESTS.md` пайплайна).
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { assembleTest } from './app.js';
import { familyOverride } from './overrides.js';

import { makeApp } from '@nestling/app';
import { makeToken, makeTokenFamily } from '@nestling/container';
import type { ResponseContext } from '@nestling/pipeline';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

interface IUsersRepository {
  findById(id: string): Promise<{ id: string } | null>;
}

const UsersRepository = makeToken<IUsersRepository>('TypeTestUsersRepository');

interface ILoggerService {
  log(message: string): void;
}

const ILogger = makeTokenFamily<ILoggerService, [scope: string]>(
  'TypeTestLogger',
);

const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  handler: async (input) => new Ok({ id: input.id, name: 'Alice' }),
});

const Ping = httpEndpoint({
  method: 'GET',
  path: '/ping',
  output: z.object({ pong: z.boolean() }),
  handler: async () => new Ok({ pong: true }),
});

// ---------------------------------------------------------------------------
// overrides: пара типизирована типом своего токена
// ---------------------------------------------------------------------------

async function overridesAcceptCompatibleFake(): Promise<void> {
  await assembleTest(makeApp({}), {
    overrides: [
      [UsersRepository, { findById: async () => ({ id: '1' }) }],
      familyOverride(ILogger, () => ({ log: (): void => undefined })),
    ],
  });
}

async function overridesRejectIncompatibleFake(): Promise<void> {
  await assembleTest(makeApp({}), {
    // @ts-expect-error: фейк без `findById` не совместим с типом токена
    overrides: [[UsersRepository, { find: async () => null }]],
  });
}

async function familyOverrideRejectsIncompatibleMember(): Promise<void> {
  await assembleTest(makeApp({}), {
    overrides: [
      // @ts-expect-error: член семейства обязан быть `ILoggerService`
      familyOverride(ILogger, () => ({ write: (): void => undefined })),
    ],
  });
}

// ---------------------------------------------------------------------------
// call: вход выводится из `input`-формы, результат — из `output`
// ---------------------------------------------------------------------------

async function callTypes(): Promise<void> {
  const app = await assembleTest(makeApp({}));

  const user = await app.call(GetUser, { id: '1' });
  type _Result = Expect<
    Equal<typeof user, ResponseContext<{ id: string; name: string }>>
  >;

  if (user.isSuccess) {
    type _Value = Expect<
      Equal<typeof user.value, { id: string; name: string }>
    >;
  }

  // @ts-expect-error: `id` объявлен строкой
  await app.call(GetUser, { id: 42 });

  // @ts-expect-error: endpoint со схемой обязан получить payload
  await app.call(GetUser);

  // Endpoint без `input`-формы вызывается одним аргументом
  const ping = await app.call(Ping);
  type _Ping = Expect<Equal<typeof ping, ResponseContext<{ pong: boolean }>>>;
}
