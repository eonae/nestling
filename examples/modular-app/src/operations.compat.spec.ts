/**
 * Отчёт совместимости операций.
 *
 * Тест собирает матрицу топологий, сводит отчёты в снимок объединением,
 * сравнивает с опубликованным в репозитории и печатает результат. То же
 * делает скрипт `src/compat.ts`; тест держит проверку в общем прогоне.
 * Обновить снимок осознанно: `UPDATE_SNAPSHOT=1 yarn compat`.
 */

import { readFileSync } from 'node:fs';

import { app } from './app.js';
import { CHECK_OPTIONS, TOPOLOGIES } from './topologies.js';

import { describe, expect, it } from '@jest/globals';
import { makeConsoleLogger } from '@nestlingjs/app';
import type { OperationSnapshot } from '@nestlingjs/testing';
import {
  checkTopologies,
  diffOperations,
  formatCompatibility,
  serializeSnapshot,
  snapshotOperations,
} from '@nestlingjs/testing';

const BASELINE_PATH = new URL('../operations.snapshot.json', import.meta.url);

/** Отчёт печатается человеку: тест вне приложения берёт свой логгер */
const logger = makeConsoleLogger();

/** Снимок в репозитории — обычный файл */
const readBaseline = (): OperationSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as OperationSnapshot;

/** Текущий состав операций: матрица топологий, сведённая в снимок */
const currentSnapshot = async (): Promise<OperationSnapshot> =>
  snapshotOperations(
    await checkTopologies(app, [...TOPOLOGIES], CHECK_OPTIONS),
  );

describe('отчёт совместимости операций', () => {
  it('текущая сборка совпадает с опубликованным снимком', async () => {
    const current = await currentSnapshot();
    const report = diffOperations(readBaseline(), current);

    logger.info(formatCompatibility(report));

    // Это проверка теста, а не фреймворка: осознанный breaking делается
    // сменой имени операции и перезаписью снимка
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);

    // Снимок детерминирован: файл побайтово равен сборке
    expect(serializeSnapshot(current)).toBe(
      readFileSync(BASELINE_PATH, 'utf8'),
    );
  });

  it('сводит матрицу объединением: операция невыбранной фичи не удалена', async () => {
    const snapshot = await currentSnapshot();

    expect(snapshot.operations.map(({ name }) => name)).toEqual([
      'notifications.check-address',
      'notifications.forget-address',
      'users.forget',
      'users.register',
      'users.registered',
    ]);

    // Каждую операцию публикует та топология, в которой выбран её владелец
    expect(
      snapshot.operations.find(({ name }) => name === 'users.register')
        ?.topologies,
    ).toEqual(['all', 'users']);
    expect(
      snapshot.operations.find(
        ({ name }) => name === 'notifications.check-address',
      )?.topologies,
    ).toEqual(['all', 'notifications']);
  });

  it('помечает удалённое поле выхода как breaking и подсказывает новое имя', async () => {
    const current = await currentSnapshot();

    // Правится снимок, а не код: так выглядела бы операция «до» изменения,
    // из выхода которой убрали поле `checkedAt`
    const baseline: OperationSnapshot = {
      ...current,
      operations: current.operations.map((operation) => {
        if (operation.name !== 'notifications.check-address') {
          return operation;
        }

        const leaf = operation.output.leaf as {
          leaf: 'schema';
          vendor: string;
          jsonSchema: {
            properties: Record<string, unknown>;
            required: string[];
          };
        };

        return {
          ...operation,
          output: {
            ...operation.output,
            leaf: {
              ...leaf,
              jsonSchema: {
                ...leaf.jsonSchema,
                properties: {
                  ...leaf.jsonSchema.properties,
                  checkedAt: { type: 'string' },
                },
                required: [...leaf.jsonSchema.required, 'checkedAt'],
              },
            },
          },
        };
      }),
    };

    const report = diffOperations(baseline, current);

    expect(report.breaking).toMatchObject([
      {
        operation: 'notifications.check-address',
        path: 'output.checkedAt',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
    // Подсказка не переименовывает: операция адресуется прежним именем
    expect(report.operations).toContainEqual({
      operation: 'notifications.check-address',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'notifications.check-address.v2',
    });
  });
});
