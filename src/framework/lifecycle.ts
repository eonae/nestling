export type Hook = () => void | Promise<void>;

/**
 * Metadata for lifecycle hooks
 */
export interface LifecycleMetadata {
  onInitMethods: string[];
  onDestroyMethods: string[];
}

/**
 * Storage for lifecycle metadata
 */
export const lifecycleMetadata = new WeakMap<object, LifecycleMetadata>();

/**
 * Decorator for marking a method as an initialization hook.
 * The method will be called when the instance is being initialized.
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
  return function (target: any, context: ClassMethodDecoratorContext) {
    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function(this: any) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || { onInitMethods: [], onDestroyMethods: [] };
      metadata.onInitMethods.push(context.name as string);
      lifecycleMetadata.set(constructor, metadata);
    });
  };
}

/**
 * Decorator for marking a method as a destruction hook.
 * The method will be called when the instance is being destroyed.
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
  return function (target: any, context: ClassMethodDecoratorContext) {
    // The target is the method itself, we need to get the class constructor
    // We can use context.addInitializer to access the class
    context.addInitializer(function(this: any) {
      // This runs when the class is defined
      const constructor = this.constructor;
      const metadata = lifecycleMetadata.get(constructor) || { onInitMethods: [], onDestroyMethods: [] };
      metadata.onDestroyMethods.push(context.name as string);
      lifecycleMetadata.set(constructor, metadata);
    });
  };
}

/**
 * Get lifecycle hooks for a given instance
 */
export function getLifecycleHooks(instance: any): { onInit: Hook[]; onDestroy: Hook[] } {
  const metadata = lifecycleMetadata.get(instance.constructor);
  
  if (!metadata) {
    return { onInit: [], onDestroy: [] };
  }

  const onInitHooks: Hook[] = metadata.onInitMethods.map(methodName => {
    const method = instance[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Method ${methodName} is not a function in ${instance.constructor.name}`);
    }
    return method.bind(instance);
  });

  const onDestroyHooks: Hook[] = metadata.onDestroyMethods.map(methodName => {
    const method = instance[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Method ${methodName} is not a function in ${instance.constructor.name}`);
    }
    return method.bind(instance);
  });

  return { onInit: onInitHooks, onDestroy: onDestroyHooks };
}
