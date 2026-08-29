/**
 * `@nestling/contracts`: декларации, общие для сервера и клиента.
 *
 * Здесь лежит всё, из чего состоит контракт: `Ok`/`Fail` и статусы,
 * определения отказов, формы io, пометки размещения и bind-карта, сам
 * `makeContract`. Пакет не импортирует серверный код, контейнер и модули
 * Node, поэтому контракт можно импортировать во фронтенд. Это проверяет
 * `boundary.spec.ts`.
 */

/**
 * Типы Standard Schema реэкспортируются, чтобы клиенту и генератору
 * документации не понадобился `@common/misc` ради одного типа схемы.
 */
export type { Schema, SchemaIssue, StandardSchemaV1 } from '@common/misc';

export * from './contract.js';
export * from './define-fail.js';
export * from './doc.js';
export * from './families.js';
export * from './http/index.js';
export * from './io/index.js';
export * from './json-schema.js';
export * from './kernel-fails.js';
export * from './result.js';
export * from './status.js';

/**
 * Из реестра имён экспортируется только чтение. `registerContract`
 * вызывает один `makeContract`; `lookupContract` нужен рецептам семейств в
 * `@nestling/ports`, которые получают параметром имя контракта.
 */
export { lookupContract } from './registry.js';
