import { Constructor } from './common';
import { instantiableMetaStorage } from './instantiable';
import { makeToken, InjectionToken, TokenString, UnwrapInjectionTokens } from './common';

/**
 * Decorate your class with @Injectable(id, dependencies)
 * param id = InterfaceId of the interface implemented by your class (use createInterfaceId to create one)
 * param dependencies = List of InterfaceIds that will be injected into class' constructor
 */
export function Injectable<I, TDependencies extends TokenString<unknown>[]>(
  id: TokenString<I>,
  dependencies: [...TDependencies], // we can add  `| [] = [],` to make dependencies optional, but the type checker messages are quite cryptic when the decorated class has some constructor arguments
): <T extends { new (...args: UnwrapInjectionTokens<TDependencies>): I }>(
  constructor: T,
  context: ClassDecoratorContext,
) => T;

/**
 * Decorate your class with @Injectable(dependencies) - interfaceId will be auto-generated from class name
 * param dependencies = List of InterfaceIds that will be injected into class' constructor
 */
export function Injectable<TDependencies extends TokenString<unknown>[]>(
  deps: [...TDependencies],
): <T extends { new (...args: UnwrapInjectionTokens<TDependencies>): any }>(
  constructor: T,
  context: ClassDecoratorContext,
) => T;

/**
 * Decorate your class with @Injectable(dependencies) - supports classes as dependencies
 * param dependencies = List of classes or InterfaceIds that will be injected into class' constructor
 */
export function Injectable<TDependencies extends InjectionToken[]>(
  deps: [...TDependencies],
): <T extends { new (...args: UnwrapInjectionTokens<TDependencies>): any }>(
  constructor: T,
  context: ClassDecoratorContext,
) => T;

export function Injectable<I, TDependencies extends TokenString<unknown>[]>(
  idOrDependencies: TokenString<I> | [...InjectionToken[]],
  deps?: [...TDependencies],
) {
  // this is the trickiest part of the whole DI framework
  // we say, this decorator takes
  // - id (the interface that the injectable implements)
  // - dependencies (list of interface ids that will be injected to constructor)
  //
  // With then we return function that ensures that the decorated class implements the id interface
  // and its constructor has arguments of same type and order as the dependencies argument to the decorator
  return function <T extends Constructor>(
    constructor: T,
    { kind }: ClassDecoratorContext,
  ) {
    if (kind !== 'class') {
      throw new Error('Injectable decorator can only be used on a class.');
    }

    const id = typeof idOrDependencies === 'string'
      ? idOrDependencies
      : makeToken(constructor.name);

    const dependencies = typeof idOrDependencies === 'string'
      ? deps || []
      : idOrDependencies;

    instantiableMetaStorage.set(constructor, { id, dependencies });
    return constructor;
  };
}