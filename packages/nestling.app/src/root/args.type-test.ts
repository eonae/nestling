/**
 * Типовые тесты аргумента сборки.
 *
 * Файл не гоняется jest'ом: он и есть тест — если типы разойдутся, упадёт
 * `tsc` на сборке пакета. Негативные случаи закрыты `@ts-expect-error`:
 * исчезни ошибка компиляции, tsc сообщит о неиспользованной директиве.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { Ok } from '../pipeline/index.js';

import { testEndpoint } from './__fixtures__/test-transport.js';
import { makeApp } from './app.js';
import { makeFeature } from './feature.js';

import { makeSwitch } from '@nestling/container';
import { z } from 'zod';

const Storage = makeSwitch('storage', ['s3', 'local']);
const Tier = makeSwitch('tier', ['free', 'pro'], { default: 'free' });
const Debug = makeSwitch('debug', { default: 'off' });

const ping = testEndpoint({
  method: 'GET',
  path: '/ping',
  output: z.object({ ok: z.boolean() }),
  handler: async () => new Ok({ ok: true }),
});

const Users = makeFeature({ name: 'users', endpoints: [ping] });

const app = makeApp({
  features: [Users],
  switches: [Storage, Tier, Debug],
});

/** Поле переключателя без умолчания обязательно */
// @ts-expect-error 'storage' не имеет умолчания и обязано быть передано
const missingRequired = app.assemble({ tier: 'pro' });

/** Поля с умолчанием необязательны */
const onlyRequired = app.assemble({ storage: 's3' });

/** Значение вне словаря не компилируется */
// @ts-expect-error 'gcs' не значение переключателя 'storage'
const wrongValue = app.assemble({ storage: 'gcs' });

/** Перечень полей закрыт: опечатка не компилируется */
// @ts-expect-error поля 'storag' у аргумента сборки нет
const typo = app.assemble({ storage: 's3', storag: 'local' });

/** Выбор фич и замыкание едут тем же аргументом */
const full = app.assemble({
  features: 'users',
  includeDeps: true,
  storage: 'local',
  tier: 'pro',
  debug: 'on',
});

/** Строковая форма задаёт только выбор фич */
const stringForm = app.assemble('users');

/** Массив имён — та же форма */
const arrayForm = app.assemble(['users']);

/** `check` принимает те же формы */
const checked = app.check({ storage: 's3' });

/** Приложение без `switches:` принимает только выбор фич */
const plain = makeApp({ features: [Users] });

// @ts-expect-error переключателей у приложения нет
const noSwitches = plain.assemble({ storage: 's3' });

const plainObject = plain.assemble({ features: 'users', includeDeps: true });

/** Смешанная форма состава не компилируется */
const mixed = makeApp({
  endpoints: [ping],
  // @ts-expect-error форма состава одна из трёх
  features: [Users],
});

/** `providers:` рядом с `features:` не компилируется */
const shared = makeApp({
  features: [Users],
  // @ts-expect-error провайдер, общий для фич, объявляется плагином
  providers: [],
});

/** `providers:` и `modules:` одновременно не компилируются */
const bothForms = makeApp({
  endpoints: [ping],
  providers: [],
  // @ts-expect-error у состава корня один источник истины
  modules: [],
});

/** Ветка в `features:` не компилируется */
const branchedFeatures = makeApp({
  // @ts-expect-error фичи выбирает аргумент сборки
  features: [Users, Debug.when(Users)],
  switches: [Debug],
});
