/* eslint-disable @typescript-eslint/no-empty-object-type */

import { ContainerBuilder } from '../builder/index.js';
import { makeToken } from '../common.js';
import { makeModule } from '../modules/index.js';
import { classProvider, Component } from '../providers/index.js';

describe('DIGraph', () => {
  interface IServiceA {}
  interface IServiceB {}

  const TokenA = makeToken<IServiceA>('TokenA');
  const TokenB = makeToken<IServiceB>('TokenB');

  @Component([])
  class ServiceA implements IServiceA {}

  @Component([TokenA] as const)
  class ServiceB implements IServiceB {
    constructor(private readonly a: IServiceA) {
      void this.a;
    }
  }

  it('выгружает узлы графа в JSON', async () => {
    const ModuleA = makeModule({
      name: 'ModuleA',
      providers: [classProvider(TokenA, ServiceA)],
    });

    const ModuleB = makeModule({
      name: 'ModuleB',
      providers: [classProvider(TokenB, ServiceB)],
      dependsOn: [ModuleA],
    });

    const container = new ContainerBuilder().register(ModuleB).build();

    const json = await container.toJSON();

    expect(json.nodes).toEqual(
      expect.arrayContaining([
        {
          id: 'TokenA',
          metadata: { module: 'ModuleA' },
          dependencies: [],
        },
        {
          id: 'TokenB',
          metadata: { module: 'ModuleB' },
          dependencies: ['TokenA'],
        },
      ]),
    );
  });
});
