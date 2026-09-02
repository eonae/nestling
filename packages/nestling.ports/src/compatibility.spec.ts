/**
 * Дифф операций: таблица вердиктов, честный `unknown` и структурная
 * невозможность заблокировать сборку.
 */

import {
  diffOperations,
  formatCompatibility,
  suggestBump,
} from './compatibility.js';
import type { JsonValue, OperationDescriptor } from './describe.js';
import * as ports from './index.js';
import type { OperationSnapshot } from './snapshot.js';

/** Операция-фикстура: value-формы с JSON Schema обоих слотов */
const operation = (
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

/** Лист-схема известного вендора */
const schema = (jsonSchema: JsonValue) =>
  ({ leaf: 'schema', vendor: 'zod', jsonSchema }) as const;

/** Объектная JSON Schema из свойств и списка обязательных */
const object = (
  properties: Record<string, JsonValue>,
  required: string[] = [],
): JsonValue => ({ type: 'object', properties, required });

const snapshot = (...operations: OperationDescriptor[]): OperationSnapshot => ({
  snapshotVersion: 1,
  operations: operations.map((value) => ({ ...value, topologies: ['all'] })),
});

/** Форма `multipart` с одним файловым полем — фикстура для правил про файлы */
const multipartForm = (maxSize: number) =>
  ({
    kind: 'multipart',
    leaf: { leaf: 'none' },
    fields: { leaf: 'none' },
    files: { avatar: { multiple: false, maxSize } },
  }) as const;

/** Дифф одного слота двух JSON Schema — самый частый случай в таблице */
const diffSlot = (
  slot: 'input' | 'output',
  before: JsonValue,
  after: JsonValue,
) =>
  diffOperations(
    snapshot(
      operation('c', { [slot]: { kind: 'value', leaf: schema(before) } }),
    ),
    snapshot(
      operation('c', { [slot]: { kind: 'value', leaf: schema(after) } }),
    ),
  );

describe('diffOperations: структурные правила', () => {
  it('исчезновение операции — breaking, появление — additive', () => {
    const report = diffOperations(
      snapshot(operation('gone'), operation('kept')),
      snapshot(operation('kept'), operation('fresh')),
    );

    expect(report.breaking).toEqual([
      {
        operation: 'gone',
        path: '',
        description: 'operation disappeared',
        verdict: 'breaking',
      },
    ]);
    expect(report.additive.map(({ operation: name }) => name)).toEqual([
      'fresh',
    ]);
  });

  it('смена вида операции — breaking', () => {
    const report = diffOperations(
      snapshot(operation('c')),
      snapshot(operation('c', { kind: 'command' })),
    );

    expect(report.breaking).toMatchObject([
      {
        path: 'kind',
        description: 'operation kind changed: request → command',
      },
    ]);
  });

  it('смена вида формы io — breaking', () => {
    const report = diffOperations(
      snapshot(operation('c')),
      snapshot(
        operation('c', { output: { kind: 'stream', leaf: { leaf: 'none' } } }),
      ),
    );

    expect(report.breaking).toMatchObject([
      { path: 'output', description: 'io form changed: value → stream' },
    ]);
  });

  it('смена примитивного листа — breaking', () => {
    const report = diffOperations(
      snapshot(
        operation('c', {
          output: {
            kind: 'value',
            leaf: { leaf: 'primitive', primitive: 'text' },
          },
        }),
      ),
      snapshot(
        operation('c', {
          output: {
            kind: 'value',
            leaf: { leaf: 'primitive', primitive: 'binary' },
          },
        }),
      ),
    );

    expect(report.breaking).toMatchObject([
      { path: 'output', description: 'primitive leaf changed: text → binary' },
    ]);
  });

  it('удалённый код отказа — breaking, добавленный — additive', () => {
    const report = diffOperations(
      snapshot(
        operation('c', {
          errors: [{ code: 'CARD_DECLINED', status: 'PAYMENT_REQUIRED' }],
        }),
      ),
      snapshot(
        operation('c', {
          errors: [{ code: 'QUOTA_EXCEEDED', status: 'TOO_MANY_REQUESTS' }],
        }),
      ),
    );

    expect(report.breaking).toMatchObject([
      { path: 'errors.CARD_DECLINED', description: 'declared failure removed' },
    ]);
    expect(report.additive).toMatchObject([
      { path: 'errors.QUOTA_EXCEEDED', description: 'declared failure added' },
    ]);
  });

  it('смена статуса объявленного отказа — breaking', () => {
    const report = diffOperations(
      snapshot(operation('c', { errors: [{ code: 'X', status: 'CONFLICT' }] })),
      snapshot(
        operation('c', { errors: [{ code: 'X', status: 'NOT_FOUND' }] }),
      ),
    );

    expect(report.breaking).toMatchObject([
      {
        path: 'errors.X',
        description: 'failure status changed: CONFLICT → NOT_FOUND',
      },
    ]);
  });
});

describe('diffOperations: направление берётся из слота', () => {
  it('удалённое поле выхода — breaking с путём', () => {
    const report = diffSlot(
      'output',
      object({ chargeId: { type: 'string' } }, ['chargeId']),
      object({}, []),
    );

    expect(report.breaking).toEqual([
      {
        operation: 'c',
        path: 'output.chargeId',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
  });

  it('новое обязательное поле входа — breaking, необязательное — additive', () => {
    const before = object({ amount: { type: 'number' } }, ['amount']);

    expect(
      diffSlot(
        'input',
        before,
        object({ amount: { type: 'number' }, currency: { type: 'string' } }, [
          'amount',
          'currency',
        ]),
      ).breaking,
    ).toMatchObject([
      { path: 'input.currency', description: 'property added (required)' },
    ]);

    expect(
      diffSlot(
        'input',
        before,
        object({ amount: { type: 'number' }, note: { type: 'string' } }, [
          'amount',
        ]),
      ).additive,
    ).toMatchObject([
      { path: 'input.note', description: 'property added (optional)' },
    ]);
  });

  it('одно и то же свойство даёт разные вердикты в разных слотах', () => {
    const added = object({ note: { type: 'string' } }, ['note']);

    expect(diffSlot('output', object({}), added).additive).toHaveLength(1);
    expect(diffSlot('input', object({}), added).breaking).toHaveLength(1);
  });

  it('`required` ↔ `optional` симметричны по слотам', () => {
    const optional = object({ note: { type: 'string' } }, []);
    const required = object({ note: { type: 'string' } }, ['note']);

    expect(diffSlot('input', optional, required).breaking).toMatchObject([
      { description: 'optional became required' },
    ]);
    expect(diffSlot('input', required, optional).additive).toMatchObject([
      { description: 'required became optional' },
    ]);
    expect(diffSlot('output', optional, required).additive).toMatchObject([
      { description: 'optional became required' },
    ]);
    expect(diffSlot('output', required, optional).breaking).toMatchObject([
      { description: 'required became optional' },
    ]);
  });

  it('сужение `type` во входе — breaking, расширение — additive', () => {
    expect(
      diffSlot('input', { type: ['string', 'number'] }, { type: 'string' })
        .breaking,
    ).toMatchObject([
      { path: 'input', description: expect.stringContaining("'type' changed") },
    ]);

    expect(
      diffSlot('input', { type: 'string' }, { type: ['string', 'number'] })
        .additive,
    ).toHaveLength(1);
  });

  it('ослабление гарантии выхода — breaking, усиление — additive', () => {
    expect(
      diffSlot('output', { type: 'string' }, { type: ['string', 'number'] })
        .breaking,
    ).toHaveLength(1);

    expect(
      diffSlot('output', { type: ['string', 'number'] }, { type: 'string' })
        .additive,
    ).toHaveLength(1);
  });

  it('удалённое значение enum — breaking, добавленное — additive, в обоих слотах', () => {
    for (const slot of ['input', 'output'] as const) {
      const report = diffSlot(
        slot,
        { type: 'string', enum: ['a', 'b'] },
        { type: 'string', enum: ['a', 'c'] },
      );

      expect(report.breaking).toMatchObject([
        { path: slot, description: 'enum value "b" removed' },
      ]);
      expect(report.additive).toMatchObject([
        { path: slot, description: 'enum value "c" added' },
      ]);
    }
  });

  it('рекурсия идёт по `properties` и `items`', () => {
    const report = diffSlot(
      'output',
      object({
        rows: {
          type: 'array',
          items: object({ id: { type: 'string' } }, ['id']),
        },
      }),
      object({ rows: { type: 'array', items: object({}, []) } }),
    );

    expect(report.breaking).toMatchObject([
      { path: 'output.rows[].id', description: 'property removed' },
    ]);
  });
});

describe('diffOperations: unknown вместо молчаливой совместимости', () => {
  it('узел вне подмножества даёт unknown с путём', () => {
    const report = diffSlot(
      'output',
      object({ status: { type: 'string' } }),
      object({ status: { oneOf: [{ type: 'string' }, { type: 'number' }] } }),
    );

    expect(report.unknown).toMatchObject([
      {
        path: 'output.status',
        description: expect.stringContaining('outside the parsed subset'),
      },
    ]);
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
  });

  it('незнакомое ключевое слово даёт unknown только когда изменилось', () => {
    // Совпало — расхождением не является: иначе `$schema` красил бы отчёт
    expect(
      diffSlot(
        'output',
        { $schema: 'x', type: 'string' },
        { $schema: 'x', type: 'string' },
      ).unknown,
    ).toEqual([]);

    expect(
      diffSlot(
        'output',
        { $schema: 'x', type: 'string' },
        { $schema: 'y', type: 'string' },
      ).unknown,
    ).toMatchObject([{ description: expect.stringContaining("'$schema'") }]);
  });

  it('смена вендора листа — unknown, а не breaking', () => {
    const report = diffOperations(
      snapshot(
        operation('c', {
          output: { kind: 'value', leaf: schema({ type: 'string' }) },
        }),
      ),
      snapshot(
        operation('c', {
          output: {
            kind: 'value',
            leaf: {
              leaf: 'schema',
              vendor: 'valibot',
              jsonSchema: { type: 'number' },
            },
          },
        }),
      ),
    );

    expect(report.unknown).toMatchObject([
      { path: 'output', description: 'schema vendor changed: zod → valibot' },
    ]);
    expect(report.breaking).toEqual([]);
  });

  it('непрозрачные листья с обеих сторон: структурных расхождений нет, лист — unknown', () => {
    const opaque = operation('c', {
      input: { kind: 'value', leaf: { leaf: 'opaque', vendor: 'zod' } },
      output: { kind: 'value', leaf: { leaf: 'opaque', vendor: 'zod' } },
      errors: [{ code: 'X', status: 'CONFLICT' }],
    });

    const report = diffOperations(snapshot(opaque), snapshot(opaque));

    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown.map(({ path }) => path)).toEqual(['input', 'output']);
    expect(report.unknown[0].description).toContain(
      'connect a schema converter',
    );
  });

  it('непрозрачность с одной стороны тоже даёт unknown', () => {
    const report = diffOperations(
      snapshot(
        operation('c', {
          output: { kind: 'value', leaf: { leaf: 'opaque', vendor: 'zod' } },
        }),
      ),
      snapshot(
        operation('c', {
          output: { kind: 'value', leaf: schema({ type: 'string' }) },
        }),
      ),
    );

    expect(report.unknown).toHaveLength(1);
    expect(report.breaking).toEqual([]);
  });

  it('файловые поля multipart правила не покрывают — unknown', () => {
    const report = diffOperations(
      snapshot(operation('c', { input: multipartForm(1024) })),
      snapshot(operation('c', { input: multipartForm(2048) })),
    );

    expect(report.unknown).toMatchObject([
      {
        path: 'input.files.avatar',
        description: 'multipart file field changed',
      },
    ]);
  });
});

describe('diffOperations: отчёт — значение, которое не блокирует', () => {
  it('пустой baseline даёт сплошной additive', () => {
    const report = diffOperations(
      { snapshotVersion: 1, operations: [] },
      snapshot(operation('a'), operation('b')),
    );

    expect(report.breaking).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.additive).toMatchObject([
      { operation: 'a', description: 'operation appeared' },
      { operation: 'b', description: 'operation appeared' },
    ]);
  });

  it('три breaking не бросают и ничего не собирают', () => {
    const report = diffOperations(
      snapshot(
        operation('a'),
        operation('b'),
        operation('c', {
          output: {
            kind: 'value',
            leaf: schema(object({ id: { type: 'string' } })),
          },
        }),
      ),
      snapshot(
        operation('c', {
          output: { kind: 'value', leaf: schema(object({})) },
        }),
      ),
    );

    expect(report.breaking).toHaveLength(3);
    expect(report.breaking.map(({ operation: name }) => name)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('отчёт сравним как значение', () => {
    const report = diffSlot(
      'output',
      object({ id: { type: 'string' } }),
      object({}),
    );

    expect(report.breaking).toEqual([
      {
        operation: 'c',
        path: 'output.id',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
  });

  it('baseline из будущего бросает, называя обе версии', () => {
    expect(() =>
      diffOperations(
        { snapshotVersion: 99, operations: [] },
        { snapshotVersion: 1, operations: [] },
      ),
    ).toThrow(/baseline snapshot has format version 99.*reads 1/s);
  });

  it('baseline не того вида бросает', () => {
    expect(() =>
      diffOperations(null as never, { snapshotVersion: 1, operations: [] }),
    ).toThrow(/baseline snapshot must be a value of shape/);

    expect(() =>
      diffOperations({ snapshotVersion: 1 } as never, {
        snapshotVersion: 1,
        operations: [],
      }),
    ).toThrow(/no 'operations' array/);
  });

  it('флага блокировки на публичной поверхности не существует', () => {
    // «Не блокирует» — свойство конструкции: наличие флага сделало бы
    // блокировку штатным режимом фреймворка
    const surface = JSON.stringify(Object.keys(ports));

    for (const flag of ['failOnBreaking', 'strict', 'throwOnBreaking']) {
      expect(surface).not.toContain(flag);
    }

    expect(diffOperations.length).toBe(2);
  });
});

describe('подсказка bump’а имени', () => {
  it('предлагает `.v2` операции без версии и `.v{N+1}` — с версией', () => {
    expect(suggestBump('billing.charge')).toBe('billing.charge.v2');
    expect(suggestBump('user.create.v2')).toBe('user.create.v3');
    expect(suggestBump('user.create.v9')).toBe('user.create.v10');
  });

  it('появляется в отчёте только у операции с breaking', () => {
    const report = diffOperations(
      snapshot(
        operation('billing.charge', {
          output: {
            kind: 'value',
            leaf: schema(object({ id: { type: 'string' } })),
          },
        }),
        operation('users.get'),
      ),
      snapshot(
        operation('billing.charge', {
          output: { kind: 'value', leaf: schema(object({})) },
        }),
        operation('users.get', {
          errors: [{ code: 'NEW', status: 'CONFLICT' }],
        }),
      ),
    );

    expect(report.operations).toEqual([
      {
        operation: 'billing.charge',
        breaking: 1,
        additive: 0,
        unknown: 0,
        suggestedName: 'billing.charge.v2',
      },
      { operation: 'users.get', breaking: 0, additive: 1, unknown: 0 },
    ]);
  });
});

describe('formatCompatibility', () => {
  it('печатает секции по вердиктам со счётчиками и подсказку про конвертер', () => {
    const report = diffOperations(
      snapshot(
        operation('a', {
          output: {
            kind: 'value',
            leaf: schema(object({ id: { type: 'string' } })),
          },
        }),
        operation('b', {
          input: { kind: 'value', leaf: { leaf: 'opaque', vendor: 'zod' } },
        }),
      ),
      snapshot(
        operation('a', {
          output: { kind: 'value', leaf: schema(object({})) },
          errors: [{ code: 'NEW', status: 'CONFLICT' }],
        }),
        operation('b', {
          input: { kind: 'value', leaf: { leaf: 'opaque', vendor: 'zod' } },
        }),
      ),
    );

    const text = formatCompatibility(report);

    expect(text).toContain('1 breaking, 1 additive, 1 unknown');
    expect(text).toContain('breaking (1):');
    expect(text).toContain('additive (1):');
    expect(text).toContain('unknown (1):');
    expect(text).toContain('Connect a schema converter');
    expect(text).toContain('a → a.v2');
  });

  it('на совпадающих снапшотах печатает нули и ни одной секции', () => {
    const text = formatCompatibility(
      diffOperations(snapshot(operation('a')), snapshot(operation('a'))),
    );

    expect(text).toBe(
      'Operation compatibility: 0 breaking, 0 additive, 0 unknown',
    );
  });
});
