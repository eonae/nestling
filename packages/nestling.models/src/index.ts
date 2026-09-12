/**
 * `@nestlingjs/models`: модель домена — схема плюс поведение.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Имя, которого
 * здесь нет, остаётся внутренним: его можно менять, не ломая тех, кто
 * установил пакет.
 */

// ./from-type.fn.js — 1
export { fromType } from './from-type.fn.js';

// ./from-scratch.fn.js — 2
export { fromScratch, makeModel } from './from-scratch.fn.js';
