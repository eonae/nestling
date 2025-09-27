import { Constructor } from '../common';
import { InjectionToken } from '../common';
import { Provider } from '../providers';

/**
 * Configuration for a module as a plain object
 */
export interface Module {
  /** Unique name for the module */
  name: string;
  /** Classes decorated with @Injectable or Provider objects that this module provides */
  providers?: (Constructor | Provider)[];
  /** Other modules that this module depends on */
  imports?: Module[];
  /** Classes or InterfaceIds that this module exports for other modules to use */
  exports?: InjectionToken[];
}

export const makeModule = (mod: Module): Module => mod;

/**
 * Type guard to check if an item is a Module
 */
export const isModule = (item: any): item is Module =>
  typeof item === 'object' && item !== null && typeof item.name === 'string';
