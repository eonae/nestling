/**
 * `@nestlingjs/container`: публичный API контейнера.
 *
 * Барель перечисляет имена поимённо, а не через `export *`. Список имён —
 * это и есть граница пакета: имя, которого здесь нет, остаётся внутренним,
 * и его можно менять без ломающей правки для тех, кто установил пакет.
 * Подпуть `./tokens` отдаёт подмножество этого списка — DI-токены и их
 * семейства без остального контейнера.
 *
 * Полный перечень с разбивкой по подсистемам — в README пакета.
 */

// ./common.js — 7
export { isToken, makeToken, tokenId } from './common.js';
export type {
  Constructor,
  InjectionToken,
  Token,
  UnwrapInjectionTokens,
} from './common.js';

// ./builder/index.js — 6
export { BuiltContainer, ContainerBuilder } from './builder/index.js';
export type {
  ContainerBuilderOptions,
  FamilyOverrideEntry,
  HealthResource,
  TokenOverride,
} from './builder/index.js';

// ./providers/index.js — 17
export {
  asFamilyMember,
  classProvider,
  Component,
  dependenciesOf,
  factoryProvider,
  familyProvider,
  getAutoSentinelFamily,
  Handler,
  makeTokenFamily,
  Resource,
  resourceProvider,
  valueProvider,
} from './providers/index.js';
export type {
  HealthStatus,
  ModuleProvider,
  Provider,
  ResourceProviderDefinition,
  TokenFamily,
} from './providers/index.js';

// ./lifecycle/index.js — 1
export { OnStart } from './lifecycle/index.js';

// ./modules/index.js — 2
export { makeModule } from './modules/index.js';
export type { Module } from './modules/index.js';

// ./switches/index.js — 7
export {
  branchCandidates,
  makeSwitch,
  resolveBranches,
  switchesUsed,
} from './switches/index.js';
export type { AnySwitch, Branchable, SwitchValues } from './switches/index.js';
