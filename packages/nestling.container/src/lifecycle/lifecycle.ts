/**
 * A lifecycle hook function that can be synchronous or asynchronous.
 */
export type Hook = () => void | Promise<void>;

/**
 * Collection of lifecycle hooks for a service instance.
 */
export interface LifecycleHooks {
  /** Initialization hooks to run when the service starts */
  onInit: Hook[];
  /** Destruction hooks to run when the service shuts down */
  onDestroy: Hook[];
}

/**
 * Metadata for lifecycle hooks stored on the class.
 *
 * Contains the names of methods decorated with @OnInit and @OnDestroy.
 */
export interface LifecycleMetadata {
  /** Names of methods decorated with @OnInit */
  onInit: string[];
  /** Names of methods decorated with @OnDestroy */
  onDestroy: string[];
}

/**
 * Storage for lifecycle hook metadata.
 *
 * Maps class constructors to their lifecycle metadata.
 * @internal
 */
export const lifecycleMetadata = new WeakMap<object, LifecycleMetadata>();

/**
 * Decorator for marking a method as an initialization hook.
 * The method will be called when the instance is being initialized.
 *
 * The method MUST have no parameters and return void or Promise<void>.
 * TypeScript will enforce this constraint at compile time.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   @OnInit()
 *   async initialize() {
 *     // Initialization logic
 *   }
 * }
 * ```
 */
export function OnInit() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function (this) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || {
        onInit: [],
        onDestroy: [],
      };
      metadata.onInit.push(context.name as string);
      lifecycleMetadata.set(constructor, metadata);
    });
  };
}

/**
 * Decorator for marking a method as a destruction hook.
 * The method will be called when the instance is being destroyed.
 *
 * The method MUST have no parameters and return void or Promise<void>.
 * TypeScript will enforce this constraint at compile time.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   @OnDestroy()
 *   async cleanup() {
 *     // Cleanup logic
 *   }
 * }
 * ```
 */
export function OnDestroy() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function (this) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || {
        onInit: [],
        onDestroy: [],
      };
      metadata.onDestroy.push(context.name as string);
      lifecycleMetadata.set(constructor, metadata);
    });
  };
}

/**
 * Retrieves lifecycle hooks for a given service instance.
 *
 * Extracts hook metadata from the instance's class and binds the methods
 * to the instance.
 *
 * @param instance - The service instance
 * @returns The bound lifecycle hooks
 * @internal
 */
export function getLifecycleHooks(instance: any): LifecycleHooks {
  const { onInit, onDestroy } =
    lifecycleMetadata.get(instance.constructor) || {};

  return {
    onInit: (onInit || []).map((mname) => resolveHook(instance, mname)),
    onDestroy: (onDestroy || []).map((mname) => resolveHook(instance, mname)),
  };
}

/**
 * Resolves and binds a lifecycle hook method to an instance.
 *
 * @param instance - The service instance
 * @param methodName - The name of the method to bind
 * @returns The bound hook function
 * @throws {TypeError} If the method is not a function
 * @internal
 */
export function resolveHook(instance: any, methodName: string): Hook {
  const method = instance[methodName];
  if (typeof method !== 'function') {
    throw new TypeError(
      `Method ${methodName} is not a function in ${instance.constructor.name}`,
    );
  }
  return method.bind(instance);
}
