import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import type { Module } from '@nestling/container';
import { ContainerBuilder, Injectable, makeModule } from '@nestling/container';
import { Ok } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

@Injectable([])
class UserService {
  find() {
    return 'user';
  }
}

const GetUser = httpEndpoint({
  method: 'GET',
  path: '/users/:id',
  // Path-параметру нужно поле в схеме: иначе класть его некуда
  input: z.object({ id: z.string() }),
  deps: [UserService],
  handle: (users) => async () => new Ok({ user: users.find() }),
});

describe('makeAppModule', () => {
  it('сохраняет endpoints и НЕ подмешивает их в providers', () => {
    const UsersModule = makeAppModule({
      name: 'module:users',
      providers: [UserService],
      endpoints: [GetUser],
    });

    expect(UsersModule.endpoints).toEqual([GetUser]);
    expect(UsersModule.providers).toEqual([UserService]);
  });

  it('значение присваиваемо Module и принимается imports и контейнером', async () => {
    const UsersModule = makeAppModule({
      name: 'module:users',
      providers: [UserService],
      endpoints: [GetUser],
    });

    // Присваиваемость Module — проверка типов
    const asModule: Module = UsersModule;
    const RootModule = makeModule({
      name: 'module:root',
      imports: [asModule],
    });

    const container = await new ContainerBuilder().register(RootModule).build();

    // Контейнер лишнее поле игнорирует и инстанцирует только провайдеры
    expect(container.get(UserService)).toBeInstanceOf(UserService);
  });

  it('модуль без endpoints остаётся без поля endpoints', () => {
    const PlainModule = makeAppModule({
      name: 'module:plain',
      providers: [UserService],
    });

    expect('endpoints' in PlainModule).toBe(false);
    expect(PlainModule.providers).toEqual([UserService]);
  });

  it('ProvidersFactory сохраняется как есть', async () => {
    const LazyModule = makeAppModule({
      name: 'module:lazy',
      providers: () => [UserService],
      endpoints: [GetUser],
    });

    expect(typeof LazyModule.providers).toBe('function');
    expect(LazyModule.endpoints).toEqual([GetUser]);

    const factory = LazyModule.providers as () => unknown[];
    expect(factory()).toEqual([UserService]);
  });
});
