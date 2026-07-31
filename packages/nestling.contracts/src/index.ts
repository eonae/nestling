/**
 * `@nestling/contracts` — направление-нейтральные декларации.
 *
 * Дом всего, из чего состоит контракт: результат и словарь статусов,
 * определения отказов, формы io, пометки размещения и bind-карта, сам
 * `makeContract`. Серверного кода, контейнера и Node-специфики в графе
 * импортов пакета нет — именно поэтому контракт импортируется во фронт, и
 * именно это проверяет `boundary.spec.ts`.
 */

export * from './define-fail.js';
export * from './http/index.js';
export * from './io/index.js';
export * from './kernel-fails.js';
export * from './result.js';
export * from './status.js';
