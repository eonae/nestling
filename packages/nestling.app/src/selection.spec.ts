/* eslint-disable unicorn/no-useless-undefined --
 * Реализация операции без `output` возвращает `undefined` явно: так
 * записана сигнатура хендлера в ядре (`Output<undefined>`). */
/**
 * Замыкание выбора по вызываемым операциям.
 *
 * Вызыватель — обычный токен, поэтому инжектировать его может и
 * декларация, и провайдер фичи. Оба пути обязаны тянуть за собой
 * реализацию: иначе `includeDeps` обещает больше, чем делает.
 */

import { makeFeature } from './feature.js';
import { closeOverCalls } from './selection.js';

import { describe, expect, it } from '@jest/globals';
import { Injectable } from '@nestling/container';
import { makeCommand, makeEvent, makeRequest } from '@nestling/operations';
import { Ok } from '@nestling/pipeline';
import type { Emitter, Port } from '@nestling/ports';
import { implement } from '@nestling/ports';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ClaimQuota = makeRequest({
  name: 'selection.quotas.claim',
  input: z.object({ amount: z.number() }),
  output: z.object({ granted: z.number() }),
});

const SendReceipt = makeCommand({
  name: 'selection.billing.receipt',
  input: z.object({ orderId: z.string() }),
});

const UserRegistered = makeEvent({
  name: 'selection.users.registered',
  input: z.object({ id: z.string() }),
});

const QuotasFeature = makeFeature({
  name: 'quotas',
  endpoints: [
    implement(ClaimQuota, { handler: async () => new Ok({ granted: 1 }) }),
  ],
});

const BillingFeature = makeFeature({
  name: 'billing',
  endpoints: [
    implement(SendReceipt, {
      // Команда зовёт запрос: замыкание обязано идти транзитивно
      handler: {
        deps: [ClaimQuota.caller],
        handle: (quotas: Port<typeof ClaimQuota>) => async () => {
          await quotas.call({ amount: 1 });

          return undefined;
        },
      },
    }),
  ],
});

/** Сервис-вызыватель: операцию зовёт провайдер, а не декларация */
@Injectable([ClaimQuota.caller])
class SignupService {
  constructor(private readonly quotas: Port<typeof ClaimQuota>) {}

  async signup(): Promise<void> {
    await this.quotas.call({ amount: 1 });
  }
}

const anyEndpoint = httpEndpoint({
  method: 'GET',
  path: '/users',
  handler: async () => new Ok({}),
});

const declared = (...features: readonly ReturnType<typeof makeFeature>[]) =>
  new Map(features.map((feature) => [feature.name, feature]));

describe('closeOverCalls', () => {
  it('тянет реализацию операции, вызванной декларацией', () => {
    const Users = makeFeature({
      name: 'users',
      endpoints: [
        httpEndpoint({
          method: 'POST',
          path: '/users',
          handler: {
            deps: [ClaimQuota.caller],
            handle: (quotas: Port<typeof ClaimQuota>) => async () => {
              await quotas.call({ amount: 1 });

              return new Ok({});
            },
          },
        }),
      ],
    });

    const chosen = closeOverCalls([Users], declared(Users, QuotasFeature));

    expect(chosen.map(({ name }) => name)).toEqual(['users', 'quotas']);
  });

  it('тянет реализацию операции, вызванной провайдером фичи', () => {
    const Users = makeFeature({
      name: 'users',
      providers: [SignupService],
      endpoints: [anyEndpoint],
    });

    const chosen = closeOverCalls([Users], declared(Users, QuotasFeature));

    expect(chosen.map(({ name }) => name)).toEqual(['users', 'quotas']);
  });

  it('видит вызов в модуле, привезённом через dependsOn', () => {
    const Core = { name: 'users-core', providers: [SignupService] };
    const Api = { name: 'users-api', dependsOn: [Core] };

    const Users = makeFeature({
      name: 'users',
      modules: [Api],
      endpoints: [anyEndpoint],
    });

    const chosen = closeOverCalls([Users], declared(Users, QuotasFeature));

    expect(chosen.map(({ name }) => name)).toEqual(['users', 'quotas']);
  });

  it('замыкается транзитивно', () => {
    const Users = makeFeature({
      name: 'users',
      providers: [
        {
          provide: SendReceipt.emitter,
          useFactory: (emitter: Emitter<typeof SendReceipt>) => emitter,
          deps: [SendReceipt.emitter],
        },
      ],
      endpoints: [anyEndpoint],
    });

    const chosen = closeOverCalls(
      [Users],
      declared(Users, BillingFeature, QuotasFeature),
    );

    expect(chosen.map(({ name }) => name)).toEqual([
      'users',
      'billing',
      'quotas',
    ]);
  });

  it('событие издателя не тянет', () => {
    const Publisher = makeFeature({
      name: 'publisher',
      endpoints: [
        implement(UserRegistered, {
          subscriber: 'audit',
          handler: async () => undefined,
        }),
      ],
    });

    const Subscriber = makeFeature({
      name: 'subscriber',
      providers: [
        {
          provide: UserRegistered.emitter,
          useFactory: (emitter: Emitter<typeof UserRegistered>) => emitter,
          deps: [UserRegistered.emitter],
        },
      ],
      endpoints: [anyEndpoint],
    });

    const chosen = closeOverCalls(
      [Subscriber],
      declared(Subscriber, Publisher),
    );

    expect(chosen.map(({ name }) => name)).toEqual(['subscriber']);
  });

  it('модуль с фабрикой провайдеров разбор не ломает', () => {
    const Lazy = { name: 'lazy', providers: () => [SignupService] };

    const Users = makeFeature({
      name: 'users',
      modules: [Lazy],
      endpoints: [anyEndpoint],
    });

    const chosen = closeOverCalls([Users], declared(Users, QuotasFeature));

    // Фабрика вызывается в `build()`, поэтому её вызовы здесь не видны:
    // такой вызов ловит проверка достижимости на собранном графе
    expect(chosen.map(({ name }) => name)).toEqual(['users']);
  });
});
