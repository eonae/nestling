/**
 * Снапшот операций — память о том, каким операция был опубликован.
 *
 * Собирается из отчётов структурной проверки: `check()` кладёт в отчёт
 * дескрипторы операций, **опубликованных** топологией, а сведение
 * матрицы идёт **объединением**. Иначе «фича не выбрана в топологии
 * `ops`» читалось бы как «операция удалена», и отчёт совместимости
 * краснел бы от смены состава деплоя.
 *
 * Где снапшот живёт — файл в репозитории, артефакт CI или внешний
 * registry — решает пользователь: снапшот это значение, а не файл.
 */

import type { OperationDescriptor } from './describe.js';

/** Версия формата снапшота, которую читает эта версия пакета */
export const SNAPSHOT_VERSION = 1;

/** Операция в снапшоте: дескриптор плюс перечень опубликовавших топологий */
export interface SnapshotOperation extends OperationDescriptor {
  /**
   * Топологии, опубликовавшие операция, в порядке прогона матрицы.
   *
   * Различает «операция удалена» и «фича не выбрана в этой топологии»:
   * первое видно по отсутствию операции во всём снапшоте, второе — по
   * короткому списку здесь. В дифф список не участвует: смена состава
   * деплоя операция не меняет.
   */
  readonly topologies: readonly string[];
}

/** Снапшот опубликованных операций */
export interface OperationSnapshot {
  /** Версия формата: читатель обязан уметь сказать «снапшот старше меня» */
  readonly snapshotVersion: number;

  /** Операции, отсортированные по имени */
  readonly operations: readonly SnapshotOperation[];
}

/**
 * Отчёт структурной проверки — **структурно**, без импорта из
 * `@nestling/app`.
 *
 * Стрелка зависимостей идёт от корня к пакету: `app` зависит от `ports`,
 * поэтому обратный импорт замкнул бы граф пакетов. Сведению нужно ровно
 * поле `published`, и оно его и требует.
 */
export interface OperationReport {
  readonly published?: readonly OperationDescriptor[];
}

/** Отчёт одной топологии матрицы — тоже структурно */
export interface TopologyOperationReport {
  /** Значение `select`, с которым топология собиралась */
  readonly select?: unknown;

  /** Отчёт `check()` этой топологии */
  readonly report?: OperationReport;
}

/** Что принимает `snapshotOperations`: отчёт `check()` или отчёт топологии */
export type SnapshotSource = OperationReport | TopologyOperationReport;

/** Читаемое имя топологии: им подписан операция в снапшоте */
function nameOfTopology(source: SnapshotSource, index: number): string {
  const select = (source as TopologyOperationReport).select;

  if (typeof select === 'string') {
    return select;
  }
  if (Array.isArray(select)) {
    return `[${select.map(String).join(', ')}]`;
  }

  // Объектная форма выбора: имя топологии даёт её список фич, а не
  // порядковый номер — иначе снапшот зависел бы от порядка матрицы
  const features = (select as { features?: unknown } | undefined)?.features;

  if (typeof features === 'string') {
    return features;
  }
  if (Array.isArray(features)) {
    return `[${features.map(String).join(', ')}]`;
  }

  return `#${index}`;
}

/** Достаёт дескрипторы: отчёт топологии оборачивает отчёт `check()` */
function contractsOf(source: SnapshotSource): readonly OperationDescriptor[] {
  const nested = (source as TopologyOperationReport).report;

  if (nested && typeof nested === 'object') {
    return nested.published ?? [];
  }

  return (source as OperationReport).published ?? [];
}

/**
 * Сравнивает дескрипторы как значения — по канонической сериализации.
 *
 * Дескриптор строится детерминированно (ключи JSON Schema сортируются,
 * отказы упорядочены по коду), поэтому строковое равенство здесь равно
 * структурному и не требует глубокого обхода.
 */
const sameDescriptor = (
  left: OperationDescriptor,
  right: OperationDescriptor,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Сводит отчёты структурной проверки в один снапшот.
 *
 * Принимает как отчёты `check()`, так и отчёты матрицы топологий
 * (`checkTopologies`) — во втором случае имя топологии попадает в
 * дескриптор.
 *
 * @param reports - Отчёты одной или нескольких топологий
 * @returns Снапшот с операциями, отсортированными по имени
 * @throws {Error} Если одно имя опубликовано двумя топологиями с
 * **разными** дескрипторами: одно имя — одна операция
 *
 * @example
 * ```typescript
 * const reports = await checkTopologies(spec, ['all', 'users']);
 * const snapshot = snapshotOperations(reports);
 * ```
 */
export function snapshotOperations(
  reports: readonly SnapshotSource[],
): OperationSnapshot {
  const merged = new Map<
    string,
    { descriptor: OperationDescriptor; topologies: string[] }
  >();

  for (const [index, source] of reports.entries()) {
    const topology = nameOfTopology(source, index);

    for (const descriptor of contractsOf(source)) {
      const existing = merged.get(descriptor.name);

      if (!existing) {
        merged.set(descriptor.name, { descriptor, topologies: [topology] });
        continue;
      }

      if (!sameDescriptor(existing.descriptor, descriptor)) {
        throw new Error(
          `Operation '${descriptor.name}' is published with different ` +
            `descriptors by topologies ${existing.topologies
              .map((name) => `'${name}'`)
              .join(', ')} and '${topology}'. One name is one operation: ` +
            `either the topologies implement different operations under the ` +
            `same name, or one of them was assembled with a different set ` +
            `of schema converters.`,
        );
      }

      if (!existing.topologies.includes(topology)) {
        existing.topologies.push(topology);
      }
    }
  }

  const operations = [...merged.values()]
    .map(({ descriptor, topologies }) => ({ ...descriptor, topologies }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));

  return { snapshotVersion: SNAPSHOT_VERSION, operations };
}

/**
 * Сериализует снапшот детерминированно.
 *
 * Операции упорядочены по имени, отказы — по коду, ключи JSON Schema
 * канонизированы при построении дескриптора. Два прогона на неизменном
 * графе дают побайтово одинаковую строку, поэтому файл снапшота попадает
 * в git-дифф осмысленным патчем, а не перестановкой строк.
 *
 * @param snapshot - Снапшот, построенный `snapshotOperations`
 * @returns JSON с отступом в два пробела и завершающим переводом строки
 */
export function serializeSnapshot(snapshot: OperationSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
