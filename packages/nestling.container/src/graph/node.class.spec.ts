import { makeToken } from '../common';

import { DINode } from './node.class';

describe('DINode', () => {
  const TokenA = makeToken('TokenA');
  const TokenB = makeToken('TokenB');

  it('exposes metadata and dependencies', () => {
    const child = new DINode(TokenB, [], {
      instance: { value: 1 },
      metadata: { module: 'ModuleB', exported: true },
      hooks: { onInit: [], onDestroy: [] },
      deps: [],
    });

    const node = new DINode(TokenA, [child], {
      instance: { value: 2 },
      metadata: { module: 'ModuleA' },
      hooks: { onInit: [], onDestroy: [] },
      deps: [TokenB],
    });

    expect(node.id).toBe(TokenA);
    expect(node.dependencies).toEqual([child]);
    expect(node.metadata).toEqual({ module: 'ModuleA' });
  });

  it('computes transitive dependencies', () => {
    const leaf = new DINode(TokenB, [], {
      instance: {},
      metadata: {},
      hooks: { onInit: [], onDestroy: [] },
      deps: [],
    });

    const root = new DINode(TokenA, [leaf], {
      instance: {},
      metadata: {},
      hooks: { onInit: [], onDestroy: [] },
      deps: [TokenB],
    });

    expect([...root.getAllDependencies()]).toEqual([leaf]);
  });
});
