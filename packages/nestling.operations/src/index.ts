/**
 * `@nestling/operations`: декларации, общие для сервера и клиента, и
 * примитивы потоков.
 *
 * Здесь лежит всё, из чего состоит операция: `Ok`/`Fail` и статусы,
 * определения отказов, формы io, пометки размещения и bind-карта, сам
 * `makeRequest`. Рядом — `Topic`, комбинаторы item-цепочек и помощники
 * итерации под `AbortSignal` (каталог `streams`). Пакет не импортирует
 * серверный код, контейнер и модули Node, поэтому его можно импортировать
 * во фронтенд. Это проверяет `boundary.spec.ts`.
 */

/**
 * Типы Standard Schema реэкспортируются, чтобы клиенту и генератору
 * документации не понадобился `@common/misc` ради одного типа схемы.
 */
export type { Schema, SchemaIssue, StandardSchemaV1 } from '@common/misc';

export * from './operation.js';
export * from './make-fail.js';
export * from './output.js';
export * from './doc.js';
export * from './families.js';
export * from './http/index.js';
export * from './io/index.js';
export * from './json-schema.js';
export * from './kernel-fails.js';
export * from './result.js';
export * from './schema-doc.js';
export * from './status.js';
export * from './streams/index.js';
export * from './transport-response.js';

/**
 * Из реестра имён экспортируется только чтение. `registerOperation`
 * вызывает один `makeRequest`; `lookupOperation` нужен рецептам семейств в
 * `@nestling/app`, которые получают параметром имя операции.
 */
export { lookupOperation } from './registry.js';
