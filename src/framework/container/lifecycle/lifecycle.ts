export type Hook = () => void | Promise<void>;

export interface LifecycleHooks {
  onInit: Hook[];
  onDestroy: Hook[];
}

/**
 * Metadata for lifecycle hooks
 */
export interface LifecycleMetadata {
  onInit: string[];
  onDestroy: string[];
}

/**
 * Storage for lifecycle metadata
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
    context: ClassMethodDecoratorContext<object, T>
  ) {

    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function(this) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || { onInit: [], onDestroy: [] };
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
    context: ClassMethodDecoratorContext<object, T>
  ) {
    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function(this) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || { onInit: [], onDestroy: [] };
      metadata.onDestroy.push(context.name as string);
      lifecycleMetadata.set(constructor, metadata);
    });
  };
}

/**
 * Get lifecycle hooks for a given instance
 * TODO: add correct type for instance
 */
export function getLifecycleHooks(instance: any): LifecycleHooks {
  const { onInit, onDestroy } = lifecycleMetadata.get(instance.constructor) || {};
  
  return {
    onInit: (onInit || []).map(mname => resolveHook(instance, mname)),
    onDestroy: (onDestroy || []).map(mname => resolveHook(instance, mname))
  };
}

export function resolveHook(instance: any, methodName: string): Hook {
  const method = instance[methodName];
  if (typeof method !== 'function') {
    throw new Error(`Method ${methodName} is not a function in ${instance.constructor.name}`);
  }
  return method.bind(instance);
}
