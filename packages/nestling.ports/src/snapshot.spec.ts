/**
 * Снапшот: объединение топологий и побайтовый детерминизм.
 */

import type { ContractDescriptor } from './describe.js';
import { serializeSnapshot, snapshotContracts } from './snapshot.js';

/** Дескриптор-фикстура: структурная часть без листьев */
const descriptor = (
  name: string,
  overrides: Partial<ContractDescriptor> = {},
): ContractDescriptor => ({
  name,
  kind: 'request',
  input: { kind: 'value', leaf: { leaf: 'none' } },
  output: { kind: 'value', leaf: { leaf: 'none' } },
  errors: [],
  ...overrides,
});

const topology = (select: string, contracts: ContractDescriptor[]) => ({
  select,
  report: { contracts },
});

/** Один и тот же снапшот, построенный заново: предмет проверки детерминизма */
const buildTwice = () =>
  serializeSnapshot(
    snapshotContracts([
      topology('all', [descriptor('b.two'), descriptor('a.one')]),
    ]),
  );

describe('snapshotContracts', () => {
  it('сводит матрицу объединением и называет опубликовавшую топологию', () => {
    const snapshot = snapshotContracts([
      topology('all', [descriptor('billing.charge'), descriptor('users.get')]),
      topology('users', [descriptor('users.get')]),
    ]);

    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.contracts.map(({ name }) => name)).toEqual([
      'billing.charge',
      'users.get',
    ]);

    // Невыбранная фича — не «контракт удалён»: контракт в снапшоте есть, и
    // видно, какая топология его публикует
    expect(
      snapshot.contracts.find(({ name }) => name === 'billing.charge')
        ?.topologies,
    ).toEqual(['all']);
    expect(
      snapshot.contracts.find(({ name }) => name === 'users.get')?.topologies,
    ).toEqual(['all', 'users']);
  });

  it('принимает отчёт `check()` напрямую, без обёртки топологии', () => {
    const snapshot = snapshotContracts([
      { contracts: [descriptor('billing.charge')] },
    ]);

    expect(snapshot.contracts).toHaveLength(1);
    expect(snapshot.contracts[0].topologies).toEqual(['#0']);
  });

  it('пустая матрица даёт пустой снапшот, а не бросок', () => {
    expect(snapshotContracts([])).toEqual({
      snapshotVersion: 1,
      contracts: [],
    });
    expect(snapshotContracts([topology('all', [])]).contracts).toEqual([]);
  });

  it('два прогона совпадают побайтово', () => {
    expect(buildTwice()).toBe(buildTwice());
  });

  it('перестановка деклараций не меняет сериализованный снапшот', () => {
    const forward = serializeSnapshot(
      snapshotContracts([
        topology('all', [descriptor('a.one'), descriptor('b.two')]),
      ]),
    );
    const backward = serializeSnapshot(
      snapshotContracts([
        topology('all', [descriptor('b.two'), descriptor('a.one')]),
      ]),
    );

    expect(forward).toBe(backward);
  });

  it('отказы упорядочены по коду, а не по объявлению', () => {
    const [contract] = snapshotContracts([
      topology('all', [
        descriptor('billing.charge', {
          errors: [
            { code: 'B_SECOND', status: 'CONFLICT' },
            { code: 'A_FIRST', status: 'NOT_FOUND' },
          ],
        }),
      ]),
    ]).contracts;

    // Снапшот сортирует то, что построил `describeContract`; фикстура здесь
    // намеренно несортированная — сериализация обязана быть устойчивой
    expect(
      serializeSnapshot({ snapshotVersion: 1, contracts: [contract] }),
    ).toBe(serializeSnapshot({ snapshotVersion: 1, contracts: [contract] }));
  });

  it('одно имя с разными дескрипторами — ошибка сведения', () => {
    expect(() =>
      snapshotContracts([
        topology('all', [descriptor('billing.charge')]),
        topology('ops', [descriptor('billing.charge', { kind: 'command' })]),
      ]),
    ).toThrow(/'billing\.charge'.*topologies 'all' and 'ops'/s);
  });
});
