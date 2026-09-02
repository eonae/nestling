/**
 * Снапшот: объединение топологий и побайтовый детерминизм.
 */

import type { OperationDescriptor } from './describe.js';
import { serializeSnapshot, snapshotOperations } from './snapshot.js';

/** Дескриптор-фикстура: структурная часть без листьев */
const descriptor = (
  name: string,
  overrides: Partial<OperationDescriptor> = {},
): OperationDescriptor => ({
  name,
  kind: 'request',
  input: { kind: 'value', leaf: { leaf: 'none' } },
  output: { kind: 'value', leaf: { leaf: 'none' } },
  errors: [],
  ...overrides,
});

const topology = (select: string, contracts: OperationDescriptor[]) => ({
  select,
  report: { contracts },
});

/** Один и тот же снапшот, построенный заново: предмет проверки детерминизма */
const buildTwice = () =>
  serializeSnapshot(
    snapshotOperations([
      topology('all', [descriptor('b.two'), descriptor('a.one')]),
    ]),
  );

describe('snapshotOperations', () => {
  it('сводит матрицу объединением и называет опубликовавшую топологию', () => {
    const snapshot = snapshotOperations([
      topology('all', [descriptor('billing.charge'), descriptor('users.get')]),
      topology('users', [descriptor('users.get')]),
    ]);

    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.contracts.map(({ name }) => name)).toEqual([
      'billing.charge',
      'users.get',
    ]);

    // Невыбранная фича — не «операция удалена»: операция в снапшоте есть, и
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
    const snapshot = snapshotOperations([
      { contracts: [descriptor('billing.charge')] },
    ]);

    expect(snapshot.contracts).toHaveLength(1);
    expect(snapshot.contracts[0].topologies).toEqual(['#0']);
  });

  it('пустая матрица даёт пустой снапшот, а не бросок', () => {
    expect(snapshotOperations([])).toEqual({
      snapshotVersion: 1,
      contracts: [],
    });
    expect(snapshotOperations([topology('all', [])]).contracts).toEqual([]);
  });

  it('два прогона совпадают побайтово', () => {
    expect(buildTwice()).toBe(buildTwice());
  });

  it('перестановка деклараций не меняет сериализованный снапшот', () => {
    const forward = serializeSnapshot(
      snapshotOperations([
        topology('all', [descriptor('a.one'), descriptor('b.two')]),
      ]),
    );
    const backward = serializeSnapshot(
      snapshotOperations([
        topology('all', [descriptor('b.two'), descriptor('a.one')]),
      ]),
    );

    expect(forward).toBe(backward);
  });

  it('отказы упорядочены по коду, а не по объявлению', () => {
    const [contract] = snapshotOperations([
      topology('all', [
        descriptor('billing.charge', {
          errors: [
            { code: 'B_SECOND', status: 'CONFLICT' },
            { code: 'A_FIRST', status: 'NOT_FOUND' },
          ],
        }),
      ]),
    ]).contracts;

    // Снапшот сортирует то, что построил `describeOperation`; фикстура здесь
    // намеренно несортированная — сериализация обязана быть устойчивой
    expect(
      serializeSnapshot({ snapshotVersion: 1, contracts: [contract] }),
    ).toBe(serializeSnapshot({ snapshotVersion: 1, contracts: [contract] }));
  });

  it('одно имя с разными дескрипторами — ошибка сведения', () => {
    expect(() =>
      snapshotOperations([
        topology('all', [descriptor('billing.charge')]),
        topology('ops', [descriptor('billing.charge', { kind: 'command' })]),
      ]),
    ).toThrow(/'billing\.charge'.*topologies 'all' and 'ops'/s);
  });
});
