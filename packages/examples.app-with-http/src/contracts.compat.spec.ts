/* eslint-disable no-console --
 * отчёт совместимости печатается человеку: это витрина, а не логирование
 * в проде */
/**
 * Витрина отчёта совместимости контрактов.
 *
 * Тест делает ровно то, что делал бы CI: гоняет матрицу `select`-топологий,
 * сводит её отчёты в снапшот **объединением**, сравнивает с baseline из
 * репозитория и печатает результат человеку. Ни одна его строка не может
 * уронить сборку приложения: `diffContracts` — чистая функция двух
 * значений, а падает ровно то, что здесь написано `expect`'ом.
 */

import { readFileSync } from 'node:fs';

import { observability } from './modules/logger';
import { OpsFeature, QuotasFeature, UsersFeature } from './features';

import { describe, expect, it } from '@jest/globals';
import type { SchemaDocConverter } from '@nestling/pipeline';
import { everyEndpoint, RequestId } from '@nestling/pipeline';
import type { ContractSnapshot } from '@nestling/testing';
import {
  checkTopologies,
  diffContracts,
  formatCompatibility,
  serializeSnapshot,
  snapshotContracts,
} from '@nestling/testing';
import { http, HttpTransport$ } from '@nestling/transport.http';
import { z } from 'zod';

/**
 * Конвертер схем — те самые десять строк поверх штатного конвертера
 * валидатора.
 *
 * Отдельного пакета здесь нет намеренно: `@nestling/openapi.zod` приезжает
 * со своим change'ем, и заводить второй такой пакет ради снапшота значило
 * бы обещать пользователю два.
 */
const zodConverter = (): SchemaDocConverter => ({
  vendor: 'zod',
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

/** Тот же словарь сборки, что в `main.ts`, с теми же инвариантами */
const spec = {
  features: [UsersFeature, OpsFeature, QuotasFeature],
  transports: [http({ port: 0 })],
  policies: [
    everyEndpoint({ transport: HttpTransport$ }).hasLayer(
      observability,
      'observability',
    ),
    everyEndpoint({ transport: HttpTransport$ }).hasVar(RequestId, 'requestId'),
  ],
};

/** Варианты деплоя: снапшот — объединение того, что публикует каждый */
const TOPOLOGIES = ['all', 'users', 'ops'] as const;

const BASELINE_PATH = new URL('../contracts.snapshot.json', import.meta.url);

/** Baseline — обычный файл в репозитории: значение, а не наша машинерия */
const readBaseline = (): ContractSnapshot =>
  JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ContractSnapshot;

/** Текущий состав контрактов: матрица топологий, сведённая в снапшот */
const currentSnapshot = async (): Promise<ContractSnapshot> =>
  snapshotContracts(
    await checkTopologies(spec, [...TOPOLOGIES], {
      converters: [zodConverter()],
    }),
  );

describe('пример: отчёт совместимости контрактов', () => {
  it('текущая сборка совпадает с опубликованным снапшотом', async () => {
    const current = await currentSnapshot();
    const report = diffContracts(readBaseline(), current);

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

  it('сводит матрицу объединением: контракт невыбранной фичи не «удалён»', async () => {
    const snapshot = await currentSnapshot();

    expect(snapshot.contracts.map(({ name }) => name)).toEqual([
      'quotas.claim',
      'quotas.record-signup',
      'users.registered',
    ]);

    // Топология `ops` контрактов не публикует вовсе, `users` тянет квоты
    // через `dependsOn` — и это видно в снапшоте, а не додумывается
    expect(
      snapshot.contracts.find(({ name }) => name === 'quotas.claim')
        ?.topologies,
    ).toEqual(['all', 'users']);
  });

  it('breaking подсвечивается с подсказкой bump’а — и ничего не роняет', async () => {
    const current = await currentSnapshot();

    // Правим baseline, а не код: так выглядел бы контракт «до» изменения,
    // которым из выхода выкинули поле `reservedUntil`. Схема берётся из
    // текущего дескриптора и достраивается — иначе расхождение уехало бы
    // в `unknown` на служебных ключах, которые проставляет конвертер
    const baseline: ContractSnapshot = {
      ...current,
      contracts: current.contracts.map((contract) => {
        if (contract.name !== 'quotas.claim') {
          return contract;
        }

        const leaf = contract.output.leaf as {
          leaf: 'schema';
          vendor: string;
          jsonSchema: {
            properties: Record<string, unknown>;
            required: string[];
          };
        };

        return {
          ...contract,
          output: {
            ...contract.output,
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

    const report = diffContracts(baseline, current);

    expect(report.breaking).toMatchObject([
      {
        contract: 'quotas.claim',
        path: 'output.reservedUntil',
        description: 'property removed',
        verdict: 'breaking',
      },
    ]);

    // Подсказка — только подсказка: переименования не произошло, контракт
    // по-прежнему адресуется прежним именем
    expect(report.contracts).toContainEqual({
      contract: 'quotas.claim',
      breaking: 1,
      additive: 0,
      unknown: 0,
      suggestedName: 'quotas.claim.v2',
    });

    console.log(formatCompatibility(report));
  });
});
