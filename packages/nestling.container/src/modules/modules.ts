import type { InjectionToken } from '../common';
import type { Provider, ProvidersFactory } from '../providers';

/**
 * Configuration for a module as a plain object.
 *
 * Modules are used to organize related providers and manage their visibility.
 * They support dependency injection, imports/exports, and lazy loading.
 *
 * @example
 * ```typescript
 * const userModule: Module = {
 *   name: 'UserModule',
 *   providers: [UserService, UserRepository],
 *   imports: [DatabaseModule],
 *   exports: [UserService]
 * };
 * ```
 */
export interface Module {
  /** Unique name for the module */
  name: string;
  /** Classes decorated with @Injectable or Provider objects that this module provides */
  providers?: Provider[] | ProvidersFactory;
  /** Other modules that this module depends on */
  imports?: Module[];
  /** Classes or tokens that this module exports for other modules to use */
  exports?: InjectionToken[];
}

/**
 * Helper function to create a module with type safety.
 *
 * This is a simple identity function that helps with type inference.
 *
 * @param mod - The module configuration
 * @returns The same module configuration
 *
 * @example
 * ```typescript
 * const myModule = makeModule({
 *   name: 'MyModule',
 *   providers: [MyService]
 * });
 * ```
 */
export const makeModule = (mod: Module): Module => mod;

/**
 * Type guard to check if an item is a Module.
 *
 * @param item - The item to check
 * @returns true if the item is a Module
 */
export const isModule = (item: any): item is Module =>
  typeof item === 'object' && item !== null && typeof item.name === 'string';
