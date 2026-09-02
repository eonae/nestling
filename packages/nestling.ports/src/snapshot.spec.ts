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

const topology = (select: string, published: OperationDescriptor[]) => ({
  select,
  report: { published },
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
    expect(snapshot.operations.map(({ name }) => name)).toEqual([
      'billing.charge',
      'users.get',
    ]);

    // Невыбранная фича — не «операция удалена»: операция в снапшоте есть, и
    // видно, какая топология его публикует
    expect(
      snapshot.operations.find(({ name }) => name === 'billing.charge')
        ?.topologies,
    ).toEqual(['all']);
    expect(
      snapshot.operations.find(({ name }) => name === 'users.get')?.topologies,
    ).toEqual(['all', 'users']);
  });

  it('принимает отчёт `check()` напрямую, без обёртки топологии', () => {
    const snapshot = snapshotOperations([
      { published: [descriptor('billing.charge')] },
    ]);

    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.operations[0].topologies).toEqual(['#0']);
  });

  it('пустая матрица даёт пустой снапшот, а не бросок', () => {
    expect(snapshotOperations([])).toEqual({
      snapshotVersion: 1,
      operations: [],
    });
    expect(snapshotOperations([topology('all', [])]).operations).toEqual([]);
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
    const [operation] = snapshotOperations([
      topology('all', [
        descriptor('billing.charge', {
          errors: [
            { code: 'B_SECOND', status: 'CONFLICT' },
            { code: 'A_FIRST', status: 'NOT_FOUND' },
          ],
        }),
      ]),
    ]).operations;

    // Снапшот сортирует то, что построил `describeOperation`; фикстура здесь
    // намеренно несортированная — сериализация обязана быть устойчивой
    expect(
      serializeSnapshot({ snapshotVersion: 1, operations: [operation] }),
    ).toBe(serializeSnapshot({ snapshotVersion: 1, operations: [operation] }));
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
