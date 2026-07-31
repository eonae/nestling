/**
 * `@nestling/contracts` — направление-нейтральные декларации.
 *
 * Дом всего, из чего состоит контракт: результат и словарь статусов,
 * определения отказов, формы io, пометки размещения и bind-карта, сам
 * `makeContract`. Серверного кода, контейнера и Node-специфики в графе
 * импортов пакета нет — именно поэтому контракт импортируется во фронт, и
 * именно это проверяет `boundary.spec.ts`.
 */

export * from './contract.js';
export * from './define-fail.js';
export * from './families.js';
export * from './http/index.js';
export * from './io/index.js';
export * from './kernel-fails.js';
export * from './result.js';
export * from './status.js';

/**
 * Из реестра имён наружу уходит только чтение.
 *
 * `registerContract` остаётся приватным — регистрирует единственный
 * вызывающий, сам `makeContract`. `lookupContract` пришлось открыть: его
 * читает рецепт семейства вызывателей, который получает параметром **имя** и
 * живёт теперь в другом пакете (`@nestling/ports`). Ответа на вопрос «что
 * обслуживает приложение» реестр по-прежнему не даёт — на него отвечает
 * дискавери из дерева модулей.
 */
export { lookupContract } from './registry.js';
