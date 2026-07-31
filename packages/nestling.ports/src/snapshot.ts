/**
 * Снапшот контрактов — память о том, каким контракт был опубликован.
 *
 * Собирается из отчётов структурной проверки: `check()` кладёт в отчёт
 * дескрипторы контрактов, **опубликованных** топологией, а сведение
 * матрицы идёт **объединением**. Иначе «фича не выбрана в топологии
 * `ops`» читалось бы как «контракт удалён», и отчёт совместимости
 * краснел бы от смены состава деплоя.
 *
 * Где снапшот живёт — файл в репозитории, артефакт CI или внешний
 * registry — решает пользователь: снапшот это значение, а не файл.
 */

import type { ContractDescriptor } from './describe.js';

/** Версия формата снапшота, которую читает эта версия пакета */
export const SNAPSHOT_VERSION = 1;

/** Контракт в снапшоте: дескриптор плюс перечень опубликовавших топологий */
export interface SnapshotContract extends ContractDescriptor {
  /**
   * Топологии, опубликовавшие контракт, в порядке прогона матрицы.
   *
   * Различает «контракт удалён» и «фича не выбрана в этой топологии»:
   * первое видно по отсутствию контракта во всём снапшоте, второе — по
   * короткому списку здесь. В дифф список не участвует: смена состава
   * деплоя контракт не меняет.
   */
  readonly topologies: readonly string[];
}

/** Снапшот опубликованных контрактов */
export interface ContractSnapshot {
  /** Версия формата: читатель обязан уметь сказать «снапшот старше меня» */
  readonly snapshotVersion: number;

  /** Контракты, отсортированные по имени */
  readonly contracts: readonly SnapshotContract[];
}

/**
 * Отчёт структурной проверки — **структурно**, без импорта из
 * `@nestling/app`.
 *
 * Стрелка зависимостей идёт от корня к пакету: `app` зависит от `ports`,
 * поэтому обратный импорт замкнул бы граф пакетов. Сведению нужно ровно
 * поле `contracts`, и оно его и требует.
 */
export interface ContractReport {
  readonly contracts?: readonly ContractDescriptor[];
}

/** Отчёт одной топологии матрицы — тоже структурно */
export interface TopologyContractReport {
  /** Значение `select`, с которым топология собиралась */
  readonly select?: unknown;

  /** Отчёт `check()` этой топологии */
  readonly report?: ContractReport;
}

/** Что принимает `snapshotContracts`: отчёт `check()` или отчёт топологии */
export type SnapshotSource = ContractReport | TopologyContractReport;

/** Читаемое имя топологии: им подписан контракт в снапшоте */
function nameOfTopology(source: SnapshotSource, index: number): string {
  const select = (source as TopologyContractReport).select;

  if (typeof select === 'string') {
    return select;
  }
  if (Array.isArray(select)) {
    return `[${select.map(String).join(', ')}]`;
  }

  return `#${index}`;
}

/** Достаёт дескрипторы: отчёт топологии оборачивает отчёт `check()` */
function contractsOf(source: SnapshotSource): readonly ContractDescriptor[] {
  const nested = (source as TopologyContractReport).report;

  if (nested && typeof nested === 'object') {
    return nested.contracts ?? [];
  }

  return (source as ContractReport).contracts ?? [];
}

/**
 * Сравнивает дескрипторы как значения — по канонической сериализации.
 *
 * Дескриптор строится детерминированно (ключи JSON Schema сортируются,
 * отказы упорядочены по коду), поэтому строковое равенство здесь равно
 * структурному и не требует глубокого обхода.
 */
const sameDescriptor = (
  left: ContractDescriptor,
  right: ContractDescriptor,
): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Сводит отчёты структурной проверки в один снапшот.
 *
 * Принимает как отчёты `check()`, так и отчёты матрицы топологий
 * (`checkTopologies`) — во втором случае имя топологии попадает в
 * дескриптор.
 *
 * @param reports - Отчёты одной или нескольких топологий
 * @returns Снапшот с контрактами, отсортированными по имени
 * @throws {Error} Если одно имя опубликовано двумя топологиями с
 * **разными** дескрипторами: одно имя — один контракт
 *
 * @example
 * ```typescript
 * const reports = await checkTopologies(spec, ['all', 'users']);
 * const snapshot = snapshotContracts(reports);
 * ```
 */
export function snapshotContracts(
  reports: readonly SnapshotSource[],
): ContractSnapshot {
  const merged = new Map<
    string,
    { descriptor: ContractDescriptor; topologies: string[] }
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
          `Contract '${descriptor.name}' is published with different ` +
            `descriptors by topologies ${existing.topologies
              .map((name) => `'${name}'`)
              .join(', ')} and '${topology}'. One name is one contract: ` +
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

  const contracts = [...merged.values()]
    .map(({ descriptor, topologies }) => ({ ...descriptor, topologies }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));

  return { snapshotVersion: SNAPSHOT_VERSION, contracts };
}

/**
 * Сериализует снапшот детерминированно.
 *
 * Контракты упорядочены по имени, отказы — по коду, ключи JSON Schema
 * канонизированы при построении дескриптора. Два прогона на неизменном
 * графе дают побайтово одинаковую строку, поэтому файл снапшота попадает
 * в git-дифф осмысленным патчем, а не перестановкой строк.
 *
 * @param snapshot - Снапшот, построенный `snapshotContracts`
 * @returns JSON с отступом в два пробела и завершающим переводом строки
 */
export function serializeSnapshot(snapshot: ContractSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
