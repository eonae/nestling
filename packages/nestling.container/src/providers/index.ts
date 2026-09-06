export * from './role.decorators.js';
// Из `role.metadata.js` баррель отдаёт только чтение: писатель остаётся
// внутри модуля, поэтому запись мимо декоратора роли снаружи пакета
// невыразима
export type { ClassRole, RoleMetadata } from './role.metadata.js';
export { decoratorOf, readRoleMeta } from './role.metadata.js';
export * from './token-family.js';
export * from './variants.js';
