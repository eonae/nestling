export * from './app.js';
export * from './discovery.js';
export * from './module.js';

/**
 * Типы точки привязки конфига — чтобы корень не импортировал
 * `@nestling/config` ради одной аннотации.
 */
export type { ConfigBinding, ConfigTarget } from '@nestling/config';
