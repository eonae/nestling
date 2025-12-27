/* eslint-disable @typescript-eslint/no-empty-object-type */

import { ContainerBuilder } from '../builder';
import { makeToken } from '../common';
import { makeModule } from '../modules';
import { classProvider, Injectable } from '../providers';

describe('DIGraph', () => {
  interface IServiceA {}
  interface IServiceB {}

  const TokenA = makeToken<IServiceA>('TokenA');
  const TokenB = makeToken<IServiceB>('TokenB');

  @Injectable(TokenA, [])
  class ServiceA implements IServiceA {}

  @Injectable(TokenB, [TokenA] as const)
  class ServiceB implements IServiceB {
    constructor(private readonly a: IServiceA) {
      void this.a;
    }
  }

  it('exports graph nodes to JSON', async () => {
    const ModuleA = makeModule({
      name: 'ModuleA',
      providers: [classProvider(TokenA, ServiceA)],
      exports: [TokenA],
    });

    const ModuleB = makeModule({
      name: 'ModuleB',
      providers: [classProvider(TokenB, ServiceB)],
      imports: [ModuleA],
    });

    const container = await new ContainerBuilder().register(ModuleB).build();

    const json = await container.toJSON();

    expect(json.nodes).toEqual(
      expect.arrayContaining([
        {
          id: 'TokenA',
          metadata: { module: 'ModuleA', exported: true },
          dependencies: [],
        },
        {
          id: 'TokenB',
          metadata: { module: 'ModuleB', exported: undefined },
          dependencies: ['TokenA'],
        },
      ]),
    );
  });
});
