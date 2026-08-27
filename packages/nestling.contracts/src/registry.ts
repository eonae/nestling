/**
 * Приватный реестр «имя контракта → контракт».
 *
 * Не экспортируется из `index.ts`: он не отвечает на вопрос «что
 * обслуживает приложение» (на него отвечает дискавери из дерева модулей) и
 * не влияет на состав графа. Единственное его назначение — дать рецепту
 * семейства вызывателей, который получает параметром **имя**, само значение
 * контракта: схемы, вид и `errors:`.
 *
 * Модульное состояние — той же природы, что мемоизация членов семейств:
 * две копии пакета в зависимостях дадут два реестра, поэтому дубль имени
 * ловится с текстом, называющим и имя, и эту причину.
 */

import type { AnyContract } from './contract.js';

const contracts = new Map<string, AnyContract>();

/**
 * Регистрирует контракт под его именем.
 *
 * @throws {Error} Если имя уже занято другим контрактом
 */
export const registerContract = (contract: AnyContract): void => {
  const existing = contracts.get(contract.name);

  if (existing && existing !== contract) {
    throw new Error(
      `Contract '${contract.name}' is already declared. A contract name is ` +
        `an address — the bus subject and the discovery key — so it must be ` +
        `unique. Either share one contract value between its consumers ` +
        `(declare it once and import that value), or give the two contracts ` +
        `different names (a version goes into the name: ` +
        `'${contract.name}.v2'). If neither is the case, check for a ` +
        `duplicated package in your dependencies — two copies give two ` +
        `values of the same contract.`,
    );
  }

  contracts.set(contract.name, contract);
};

/**
 * Находит контракт по имени.
 *
 * @internal Читают рецепты семейств вызывателей
 */
export const lookupContract = (name: string): AnyContract | undefined =>
  contracts.get(name);
