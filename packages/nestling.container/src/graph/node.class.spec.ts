import { makeToken } from '../common.js';
import { valueProvider } from '../providers/index.js';

import { DINode } from './node.class.js';

describe('DINode', () => {
  const TokenA = makeToken<number>('TokenA');
  const TokenB = makeToken<number>('TokenB');

  const node = (id: string): DINode =>
    new DINode(id, {
      provider: valueProvider(id === 'TokenA' ? TokenA : TokenB, 1),
      metadata: { module: `Module${id.at(-1)}` },
    });

  it('хранит метаданные и зависимости', () => {
    const child = node('TokenB');
    const parent = node('TokenA');

    parent.linkDependencies([child]);

    expect(parent.id).toBe('TokenA');
    expect(parent.dependencies).toEqual([child]);
    expect(parent.metadata).toEqual({ module: 'ModuleA' });
  });

  it('вычисляет транзитивные зависимости', () => {
    const leaf = node('TokenB');
    const root = node('TokenA');

    root.linkDependencies([leaf]);

    expect([...root.getAllDependencies()]).toEqual([leaf]);
  });

  it('до instantiate() слот значения пуст', () => {
    const single = node('TokenA');

    expect(single.created).toBe(false);
    expect(single.instance).toBeUndefined();
  });
});
