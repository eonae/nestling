/* eslint-disable no-console -- отчёт совместимости печатается человеку */
/**
 * Отчёт совместимости операций: то, что делал бы CI.
 *
 * Тест собирает матрицу `select`-топологий, сводит отчёты в снапшот
 * объединением, сравнивает с baseline из репозитория и печатает результат.
 * Обновить baseline осознанно: `UPDATE_SNAPSHOT=1 yarn test`.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { app } from './app';
import { appConfigKeys } from './app.config';

import { describe, expect, it } from '@jest/globals';
import { makeApp } from '@nestling/app';
import { objectSource } from '@nestling/config';
import { zodConverter } from '@nestling/openapi.zod';
import type { OperationSnapshot } from '@nestling/testing';
import {
  checkTopologies,
  diffOperations,
  formatCompatibility,
  serializeSnapshot,
  snapshotOperations,
} from '@nestling/testing';

/**
 * Та же декларация с секретами из объекта: `check()` собирает граф, и
 * секция читается
 */
const checked = makeApp({
  features: app.spec.features,
  plugins: app.spec.plugins,
  policies: app.spec.policies,
  transports: app.spec.transports,
  config: [
    [
      objectSource(
        { API_TOKEN: 'test-token', WEBHOOK_SECRET: 'test-hook' },
        'test',
      ),
      appConfigKeys,
    ],
  ],
});

/** Варианты деплоя: снапшот объединяет то, что публикует каждый */
const TOPOLOGIES = [
  'all',
  { features: 'users', includeDeps: true },
  'ops',
] as const;

const BASELINE_PATH = new URL('../operations.snapshot.json', import.meta.url);

/** Baseline — обычный файл в репозитории */
const readBaseline = (): OperationSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as OperationSnapshot;

/** Текущий состав операций: матрица топологий, сведённая в снапшот */
const currentSnapshot = async (): Promise<OperationSnapshot> =>
  snapshotOperations(
    await checkTopologies(checked, [...TOPOLOGIES], {
      converters: [zodConverter()],
    }),
  );

describe('отчёт совместимости операций', () => {
  it('текущая сборка совпадает с опубликованным снапшотом', async () => {
    const current = await currentSnapshot();

    if (process.env.UPDATE_SNAPSHOT) {
      writeFileSync(BASELINE_PATH, serializeSnapshot(current));
    }

    const report = diffOperations(readBaseline(), current);
    console.log(formatCompatibility(report));

    // Это проверка теста, а не фреймворка: осознанный breaking делается
    // сменой имени операции и перезаписью снапшота
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);

    // Снапшот детерминирован: файл побайтово равен сборке
    expect(serializeSnapshot(current)).toBe(
      readFileSync(BASELINE_PATH, 'utf8'),
    );
  });

  it('сводит матрицу объединением: операция невыбранной фичи не удалена', async () => {
    const snapshot = await currentSnapshot();

    expect(snapshot.operations.map(({ name }) => name)).toEqual([
      'quotas.claim',
      'quotas.record-signup',
      'subscriptions.closed',
      'subscriptions.opened',
      'users.registered',
    ]);

    // `users` тянет квоты замыканием по вызову `quotas.claim`
    expect(
      snapshot.operations.find(({ name }) => name === 'quotas.claim')
        ?.topologies,
    ).toEqual(['all', 'users']);
    // Факты подписок публикует `ops`, и она приходит только явным выбором
    expect(
      snapshot.operations.find(({ name }) => name === 'subscriptions.opened')
        ?.topologies,
    ).toEqual(['all', 'ops']);
  });

  it('помечает удалённое поле выхода как breaking и подсказывает новое имя', async () => {
    const current = await currentSnapshot();

    // Правится baseline, а не код: так выглядела бы операция «до» изменения,
    // из выхода которой убрали поле `reservedUntil`
    const baseline: OperationSnapshot = {
      ...current,
      operations: current.operations.map((operation) => {
        if (operation.name !== 'quotas.claim') {
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
                  reservedUntil: { type: 'string' },
                },
                required: [...leaf.jsonSchema.required, 'reservedUntil'],
              },
            },
          },
        };
      }),
    };

    const report = diffOperations(baseline, current);

    expect(report.breaking).toMatchObject([
      {
        operation: 'quotas.claim',
        path: 'output.reservedUntil',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);
    // Подсказка не переименовывает: операция адресуется прежним именем
    expect(report.operations).toContainEqual({
      operation: 'quotas.claim',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'quotas.claim.v2',
    });
  });
});
