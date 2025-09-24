import { InjectionToken } from '../common';
import { Hook } from '../lifecycle';

/**
 * BuiltContainer provides access to instantiated services.
 * This container is immutable and only allows getting instances.
 */
export class BuiltContainer {
  readonly #instances = new Map<string, unknown>();
  readonly #initHooks: Hook[] = [];
  readonly #destroyHooks: Hook[] = [];

  constructor(instances: Map<string, unknown>, initHooks: Hook[], destroyHooks: Hook[]) {
    this.#instances = instances;
    this.#initHooks = initHooks;
    this.#destroyHooks = destroyHooks;
  }


  /**
   * Initialize all modules by calling their onInit hooks in registration order
   */
  async init(): Promise<void> {
    for (const hook of this.#initHooks) {
      await hook();
    }
  }

  /**
   * Destroy all modules by calling their onDestroy hooks in reverse order
   */
  async destroy(): Promise<void> {
    for (const hook of this.#destroyHooks) {
      await hook();
    }
  }

  /**
   * Get an instance from the container
   */
  get<T>(token: InjectionToken<T>): T {
    const id = typeof token === 'string' ? token : token.name;

    // Check if instance already exists
    if (this.#instances.has(id)) {
      return this.#instances.get(id) as T;
    }

    throw new Error(`Instance for interface '${id}' is not in the container.`);
  }
}
