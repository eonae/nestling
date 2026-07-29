import { makeAppModule } from './module';

import { describe, expect, it } from '@jest/globals';
import type { Module } from '@nestling/container';
import { ContainerBuilder, Injectable, makeModule } from '@nestling/container';
import type { IEndpoint } from '@nestling/pipeline';
import { Endpoint, Ok } from '@nestling/pipeline';

@Injectable([])
class UserService {
  find() {
    return 'user';
  }
}

@Injectable([UserService])
@Endpoint({ transport: 'http', pattern: 'GET /users/:id' })
class GetUser implements IEndpoint {
  constructor(private readonly users: UserService) {}

  async handle() {
    return new Ok({ user: this.users.find() });
  }
}

describe('makeAppModule', () => {
  it('сохраняет endpoints и дублирует их в providers', () => {
    const UsersModule = makeAppModule({
      name: 'module:users',
      providers: [UserService],
      endpoints: [GetUser],
    });

    expect(UsersModule.endpoints).toEqual([GetUser]);
    expect(UsersModule.providers).toEqual([UserService, GetUser]);
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

    // Контейнер лишнее поле игнорирует, но endpoint инстанцирует
    expect(container.get(GetUser)).toBeInstanceOf(GetUser);
  });

  it('модуль без endpoints остаётся без поля endpoints', () => {
    const PlainModule = makeAppModule({
      name: 'module:plain',
      providers: [UserService],
    });

    expect('endpoints' in PlainModule).toBe(false);
    expect(PlainModule.providers).toEqual([UserService]);
  });

  it('ProvidersFactory сохраняется, endpoints дополняют её результат', async () => {
    const LazyModule = makeAppModule({
      name: 'module:lazy',
      providers: () => [UserService],
      endpoints: [GetUser],
    });

    expect(typeof LazyModule.providers).toBe('function');
    expect(LazyModule.endpoints).toEqual([GetUser]);

    const factory = LazyModule.providers as () => Promise<unknown[]>;
    await expect(factory()).resolves.toEqual([UserService, GetUser]);
  });
});
