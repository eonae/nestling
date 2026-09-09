/**
 * Фаза 0 как значение: состав приложения по декларации и аргументу.
 *
 * Одна функция стоит и за сборкой, и за `app.discover(args)`, поэтому
 * проверяется она сама: раскрытие веток, выбор фич, замыкание по вызовам
 * и ошибки, которые обязаны падать до захвата ресурсов.
 */

import { Ok } from '../pipeline/index.js';
import type { Port } from '../ports/index.js';
import { implement } from '../ports/index.js';
import { transportValue } from '../transport/index.js';

import { testServer } from './__fixtures__/test-server.js';
import {
  ALL_FORMS,
  testEndpoint,
  TestTransport$,
} from './__fixtures__/test-transport.js';
import { resolveComposition } from './composition.js';
import { makeFeature, makePlugin } from './feature.js';
import { MockTransport } from './helpers.js';
import { normalizeSpec } from './plan.js';

import { describe, expect, it } from '@jest/globals';
import { Handler, makeSwitch } from '@nestling/container';
import { makeRequest } from '@nestling/operations';
import { z } from 'zod';

const Docs = makeSwitch('docs', { default: 'on' });
const Storage = makeSwitch('storage', ['s3', 'local']);

const transport = () =>
  transportValue(TestTransport$('default'), new MockTransport(), {
    capabilities: ALL_FORMS,
  });

const ping = (path: string) =>
  testEndpoint({
    method: 'GET',
    path,
    output: z.object({ ok: z.boolean() }),
    handler: async () => new Ok({ ok: true }),
  });

const ClaimQuota = makeRequest({
  name: 'composition.quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
});

const QuotasFeature = makeFeature({
  name: 'quotas',
  endpoints: [
    implement(ClaimQuota, { handler: async () => new Ok({ granted: 1 }) }),
  ],
});

/** Декларация-вызыватель: её фича тянет за собой реализацию операции */
@Handler([ClaimQuota.caller])
class SignupHandler {
  constructor(private readonly quotas: Port<typeof ClaimQuota>) {}

  async handle() {
    await this.quotas.call({ amount: 1 });

    return new Ok({ ok: true });
  }
}

const UsersFeature = makeFeature({
  name: 'users',
  endpoints: [
    testEndpoint({
      method: 'POST',
      path: '/users',
      output: z.object({ ok: z.boolean() }),
      handler: SignupHandler,
    }),
  ],
});

const BillingFeature = makeFeature({
  name: 'billing',
  endpoints: [ping('/billing')],
});

const DocsPlugin = makePlugin({
  name: 'docs',
  endpoints: [ping('/openapi.json')],
});

const spec = normalizeSpec({
  features: [UsersFeature, QuotasFeature, BillingFeature],
  plugins: [Docs.when(DocsPlugin)],
  switches: [Docs, Storage],
  transports: [transport()],
});

const namesOf = (bundles: readonly { name: string }[]) =>
  bundles.map(({ name }) => name);

describe('resolveComposition', () => {
  it('без аргумента: все фичи, умолчания переключателей', () => {
    const composition = resolveComposition(spec, { storage: 's3' });

    expect(namesOf(composition.features)).toEqual([
      'users',
      'quotas',
      'billing',
    ]);
    expect(composition.switches).toEqual({ docs: 'on', storage: 's3' });
  });

  it('выбор фич: невыбранная фича в состав не входит', () => {
    const composition = resolveComposition(spec, {
      features: 'users',
      storage: 's3',
    });

    expect(namesOf(composition.features)).toEqual(['users']);
    expect(namesOf(composition.bundles)).toEqual(['users', 'docs']);
  });

  it('ветка переключателя раскрыта: при `docs=off` плагина в составе нет', () => {
    const composition = resolveComposition(spec, {
      docs: 'off',
      storage: 's3',
    });

    expect(namesOf(composition.alwaysOn)).toEqual([]);
    expect(namesOf(composition.bundles)).toEqual([
      'users',
      'quotas',
      'billing',
    ]);
  });

  it('замыкание по вызовам добавляет фичу, `named` остаётся выбором', () => {
    const composition = resolveComposition(spec, {
      features: 'users',
      includeDeps: true,
      storage: 's3',
    });

    expect(namesOf(composition.features)).toEqual(['users', 'quotas']);
    expect(composition.named).toEqual(['users']);
    expect(composition.includeDeps).toBe(true);
  });

  it('раскрытие фичи считается один раз: замыкание не удваивает единицу', () => {
    const composition = resolveComposition(spec, {
      features: ['users', 'quotas'],
      includeDeps: true,
      storage: 's3',
    });

    // Замыкание сверяет единицы по идентичности значения: раскрой фичу
    // дважды — и уже выбранная реализация попала бы в состав второй раз
    expect(namesOf(composition.features)).toEqual(['users', 'quotas']);
  });

  it('транспорты и серверы разделены после раскрытия веток', () => {
    const server = testServer({ marks: [] });

    const composition = resolveComposition(
      normalizeSpec({
        endpoints: [ping('/ping')],
        transports: [transport(), server],
        switches: [Storage],
      }),
      { storage: 'local' },
    );

    expect(composition.transports).toHaveLength(1);
    expect(namesOf(composition.servers)).toEqual(['default']);
    expect(namesOf(composition.alwaysOn)).toEqual(['app']);
  });

  it('результат детерминирован: два вызова с одним аргументом равны', () => {
    const args = { features: 'users', includeDeps: true, storage: 'local' };

    const first = resolveComposition(spec, args);
    const second = resolveComposition(spec, args);

    expect(namesOf(second.features)).toEqual(namesOf(first.features));
    expect(namesOf(second.bundles)).toEqual(namesOf(first.bundles));
    expect(second.switches).toEqual(first.switches);
    expect(second.named).toEqual(first.named);
    expect(second.includeDeps).toBe(first.includeDeps);
  });

  it('опечатка в имени фичи падает здесь', () => {
    expect(() =>
      resolveComposition(spec, { features: 'userz', storage: 's3' }),
    ).toThrow(/Unknown feature 'userz'.*users, quotas, billing/s);
  });

  it('значение вне словаря переключателя падает здесь', () => {
    expect(() => resolveComposition(spec, { storage: 'gcs' } as never)).toThrow(
      /Switch 'storage' has no value "gcs"/,
    );
  });

  it('переключатель без умолчания требует поля аргумента', () => {
    expect(() => resolveComposition(spec)).toThrow(
      /Switch 'storage' has no default/,
    );
  });
});
