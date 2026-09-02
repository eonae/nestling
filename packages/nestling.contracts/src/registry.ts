/**
 * Реестр операций по имени.
 *
 * Реестр не отвечает на вопрос «что обслуживает приложение» (на него
 * отвечает discovery по дереву модулей) и не влияет на состав графа. Его
 * единственная задача — отдать рецепту семейства портов значение операции
 * по имени: схемы, вид и `errors`.
 *
 * Реестр — состояние модуля. Две копии пакета в зависимостях дадут два
 * реестра, поэтому текст ошибки о дубле имени упоминает и эту причину.
 */

import type { AnyOperation } from './contract.js';

const contracts = new Map<string, AnyOperation>();

/**
 * Регистрирует операция под его именем.
 *
 * @throws {Error} Если имя уже занято другим операцией
 */
export const registerOperation = (contract: AnyOperation): void => {
  const existing = contracts.get(contract.name);

  if (existing && existing !== contract) {
    throw new Error(
      `Operation '${contract.name}' is already declared. A contract name is ` +
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
 * Находит операция по имени.
 *
 * @internal Используется рецептами семейств `PortFamily` и `EmitterFamily`
 */
export const lookupOperation = (name: string): AnyOperation | undefined =>
  contracts.get(name);
