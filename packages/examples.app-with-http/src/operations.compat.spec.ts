/* eslint-disable no-console --
 * отчёт совместимости печатается человеку: это витрина, а не логирование
 * в проде */
/**
 * Витрина отчёта совместимости операций.
 *
 * Тест делает ровно то, что делал бы CI: гоняет матрицу `select`-топологий,
 * сводит её отчёты в снапшот **объединением**, сравнивает с baseline из
 * репозитория и печатает результат человеку. Ни одна его строка не может
 * уронить сборку приложения: `diffOperations` — чистая функция двух
 * значений, а падает ровно то, что здесь написано `expect`'ом.
 */

import { readFileSync } from 'node:fs';

import { observability } from './modules/logger';
import { OpsFeature, QuotasFeature, UsersFeature } from './features';
import { appLogging, appSubscriptions } from './infrastructure';

import { describe, expect, it } from '@jest/globals';
import type { SchemaDocConverter } from '@nestling/pipeline';
import { everyEndpoint, RequestId } from '@nestling/pipeline';
import type { OperationSnapshot } from '@nestling/testing';
import {
  checkTopologies,
  diffOperations,
  formatCompatibility,
  serializeSnapshot,
  snapshotOperations,
} from '@nestling/testing';
import { http, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Конвертер схем: десять строк поверх штатного конвертера валидатора.
 *
 * Отдельного пакета здесь нет: `@nestling/openapi.zod` появится отдельным
 * change'ем, и заводить второй такой же пакет ради одного снапшота значило
 * бы обещать пользователю два.
 */
const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

/** Тот же словарь сборки и те же инварианты, что и в `main.ts`. */
const spec = {
  features: [UsersFeature, OpsFeature, QuotasFeature],
  plugins: [appLogging, appSubscriptions],
  transports: [http({ port: 0 })],
  policies: [
    everyEndpoint({ transport: HttpTransport$('default') }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({ transport: HttpTransport$('default') }).hasVar(
      RequestId,
      'requestId',
    ),
  ],
};

/**
 * Варианты деплоя: снапшот — объединение того, что публикует каждый.
 *
 * `includeDeps` замыкает выбор по вызываемым операциям: `users` зовёт
 * `quotas.claim`, и фича квот подключается сама.
 */
const TOPOLOGIES = [
  'all',
  { features: 'users', includeDeps: true },
  'ops',
] as const;

const BASELINE_PATH = new URL('../operations.snapshot.json', import.meta.url);

/** Baseline — обычный файл в репозитории: значение, а не код фреймворка */
const readBaseline = (): OperationSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as OperationSnapshot;

/** Текущий состав операций: матрица топологий, сведённая в снапшот */
const currentSnapshot = async (): Promise<OperationSnapshot> =>
  snapshotOperations(
    await checkTopologies(spec, [...TOPOLOGIES], {
      converters: [zodConverter()],
    }),
  );

describe('пример: отчёт совместимости операций', () => {
  it('текущая сборка совпадает с опубликованным снапшотом', async () => {
    const current = await currentSnapshot();
    const report = diffOperations(readBaseline(), current);

    console.log(formatCompatibility(report));

    // Это `expect` теста, а не fail-fast фреймворка: осознанный breaking
    // делается сменой имени и перезаписью файла снапшота
    expect(report.breaking).toEqual([]);
    expect(report.additive).toEqual([]);
    expect(report.unknown).toEqual([]);

    // Снапшот детерминирован: файл в репозитории побайтово равен сборке
    expect(serializeSnapshot(current)).toBe(
      readFileSync(BASELINE_PATH, 'utf8'),
    );
  });

  it('сводит матрицу объединением: операция невыбранной фичи не «удалена»', async () => {
    const snapshot = await currentSnapshot();

    expect(snapshot.operations.map(({ name }) => name)).toEqual([
      'quotas.claim',
      'quotas.record-signup',
      'subscriptions.closed',
      'subscriptions.opened',
      'users.registered',
    ]);

    // `users` тянет квоты замыканием по вызову `quotas.claim` — и это
    // видно в снапшоте, а не додумывается
    expect(
      snapshot.operations.find(({ name }) => name === 'quotas.claim')
        ?.topologies,
    ).toEqual(['all', 'users']);

    // Факты подписок публикует эксплуатационная фича, и тянется она
    // только явным выбором: операций, которые бы её вызывали, нет, а
    // замыкание идёт по вызовам
    expect(
      snapshot.operations.find(({ name }) => name === 'subscriptions.opened')
        ?.topologies,
    ).toEqual(['all', 'ops']);

    // Схемы фактов написаны руками (`vendor: 'nestling'`), конвертера для
    // них нет ни одного — и всё равно они в снапшоте не непрозрачны:
    // satellite аннотировал их `jsonSchema(...)`. Так независимость от
    // вендора не стоит ни документации, ни схемного диффа
    expect(
      snapshot.operations.find(({ name }) => name === 'subscriptions.opened')
        ?.input.leaf,
    ).toMatchObject({
      leaf: 'schema',
      vendor: 'nestling',
      jsonSchema: { type: 'object' },
    });
  });

  it("breaking подсвечивается с подсказкой bump'а — и ничего не роняет", async () => {
    const current = await currentSnapshot();

    // Правим baseline, а не код: так выглядел бы операция «до» изменения,
    // которым из выхода выкинули поле `reservedUntil`. Схема берётся из
    // текущего дескриптора и достраивается — иначе расхождение попало бы
    // в `unknown` на служебных ключах, которые проставляет конвертер
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

    // Подсказка — только подсказка: переименования не произошло, операция
    // по-прежнему адресуется прежним именем
    expect(report.operations).toContainEqual({
      operation: 'quotas.claim',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'quotas.claim.v2',
    });

    console.log(formatCompatibility(report));
  });
});
