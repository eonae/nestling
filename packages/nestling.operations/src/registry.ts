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

import type { AnyOperation } from './operation.js';

const operations = new Map<string, AnyOperation>();

/**
 * Регистрирует операцию под её именем.
 *
 * @throws {Error} Если имя уже занято другой операцией
 */
export const registerOperation = (operation: AnyOperation): void => {
  const existing = operations.get(operation.name);

  if (existing && existing !== operation) {
    throw new Error(
      `Operation '${operation.name}' is already declared. A operation name is ` +
        `an address — the bus subject and the discovery key — so it must be ` +
        `unique. Either share one operation value between its consumers ` +
        `(declare it once and import that value), or give the two operations ` +
        `different names (a version goes into the name: ` +
        `'${operation.name}.v2'). If neither is the case, check for a ` +
        `duplicated package in your dependencies — two copies give two ` +
        `values of the same operation.`,
    );
  }

  operations.set(operation.name, operation);
};

/**
 * Находит операцию по имени.
 *
 * @internal Используется рецептами семейств `PortFamily` и `EmitterFamily`
 */
export const lookupOperation = (name: string): AnyOperation | undefined =>
  operations.get(name);
