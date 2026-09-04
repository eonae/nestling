import { DINode } from './node.class.js';

describe('DINode', () => {
  const TokenA = 'TokenA';
  const TokenB = 'TokenB';

  it('хранит метаданные и зависимости', () => {
    const child = new DINode(TokenB, [], {
      instance: { value: 1 },
      metadata: { module: 'ModuleB' },
      hooks: { onInit: [], onStart: [], onDestroy: [] },
      deps: [],
    });

    const node = new DINode(TokenA, [child], {
      instance: { value: 2 },
      metadata: { module: 'ModuleA' },
      hooks: { onInit: [], onStart: [], onDestroy: [] },
      deps: [TokenB],
    });

    expect(node.id).toBe(TokenA);
    expect(node.dependencies).toEqual([child]);
    expect(node.metadata).toEqual({ module: 'ModuleA' });
  });

  it('вычисляет транзитивные зависимости', () => {
    const leaf = new DINode(TokenB, [], {
      instance: {},
      metadata: {},
      hooks: { onInit: [], onStart: [], onDestroy: [] },
      deps: [],
    });

    const root = new DINode(TokenA, [leaf], {
      instance: {},
      metadata: {},
      hooks: { onInit: [], onStart: [], onDestroy: [] },
      deps: [TokenB],
    });

    expect([...root.getAllDependencies()]).toEqual([leaf]);
  });
});
