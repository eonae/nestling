/**
 * `@nestlingjs/common.graphs`: направленный ациклический граф и обход узлов.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет.
 */

// ./dag.class.js — 3
export { DAG } from './dag.class.js';
export type { VisitCallback, VisitOptions } from './dag.class.js';

// ./interfaces.js — 1
export type { INode } from './interfaces.js';
