export * from './injectable.decorator.js';
// Из `injectable.metadata.js` баррель отдаёт только чтение: писатель
// остаётся внутри модуля, поэтому запись мимо декоратора `@Injectable`
// снаружи пакета невыразима
export { readInjectableMeta } from './injectable.metadata.js';
export * from './token-family.js';
export * from './variants.js';
