/**
 * Реестр контрактов по имени.
 *
 * Реестр не отвечает на вопрос «что обслуживает приложение» (на него
 * отвечает discovery по дереву модулей) и не влияет на состав графа. Его
 * единственная задача — отдать рецепту семейства портов значение контракта
 * по имени: схемы, вид и `errors`.
 *
 * Реестр — состояние модуля. Две копии пакета в зависимостях дадут два
 * реестра, поэтому текст ошибки о дубле имени упоминает и эту причину.
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
 * @internal Используется рецептами семейств `PortFamily` и `EmitterFamily`
 */
export const lookupContract = (name: string): AnyContract | undefined =>
  contracts.get(name);
