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
  /**
   * Start hooks to run after the whole graph is initialized.
   *
   * Phase START comes after WIRE, so a start hook sees a fully wired
   * application — unlike `onInit`, which only sees its own dependencies.
   */
  onStart: Hook[];
  /** Destruction hooks to run when the service shuts down */
  onDestroy: Hook[];
}

/**
 * Metadata for lifecycle hooks stored on the class.
 *
 * Contains the names of methods decorated with @OnInit, @OnStart and
 * @OnDestroy.
 */
export interface LifecycleMetadata {
  /** Names of methods decorated with @OnInit */
  onInit: string[];
  /** Names of methods decorated with @OnStart */
  onStart: string[];
  /** Names of methods decorated with @OnDestroy */
  onDestroy: string[];
}

/** Empty metadata record — one shape for all three hook kinds */
const emptyMetadata = (): LifecycleMetadata => ({
  onInit: [],
  onStart: [],
  onDestroy: [],
});

/**
 * Records a decorated method name in the class metadata exactly once.
 *
 * The initializer runs on every instance construction, so the write must be
 * idempotent: three decorators share one implementation to keep that
 * guarantee in a single place.
 */
function rememberHook(
  constructor: object,
  kind: keyof LifecycleMetadata,
  methodName: string,
): void {
  const metadata = lifecycleMetadata.get(constructor) || emptyMetadata();

  // Metadata written before this field existed (older class, same process)
  metadata[kind] ??= [];

  if (!metadata[kind].includes(methodName)) {
    metadata[kind].push(methodName);
  }

  lifecycleMetadata.set(constructor, metadata);
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
      rememberHook(this.constructor, 'onInit', context.name as string);
    });
  };
}

/**
 * Decorator for marking a method as a start hook.
 *
 * Start hooks run in phase START — after `@OnInit` of *every* node and after
 * WIRE, but before transports go live. That is the place for work which needs
 * the whole application wired: schedulers, subscriptions, consumers.
 *
 * The method MUST have no parameters and return void or Promise<void>.
 * TypeScript will enforce this constraint at compile time.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class Scheduler {
 *   @OnStart()
 *   async start() {
 *     // The graph is fully initialized here
 *   }
 * }
 * ```
 */
export function OnStart() {
  return function <T extends Hook>(
    _target: T,
    context: ClassMethodDecoratorContext<object, T>,
  ) {
    context.addInitializer(function (this) {
      rememberHook(this.constructor, 'onStart', context.name as string);
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
      rememberHook(this.constructor, 'onDestroy', context.name as string);
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
  const { onInit, onStart, onDestroy } =
    lifecycleMetadata.get(instance.constructor) || {};

  return {
    onInit: (onInit || []).map((mname) => resolveHook(instance, mname)),
    onStart: (onStart || []).map((mname) => resolveHook(instance, mname)),
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
