import type { Constructor, InjectionToken, TokenString } from '../common';
import { stringifyToken } from '../common';
import type { DINodeData, DINodeMetadata } from '../graph';
import { DIGraph, DINode } from '../graph';
import { getLifecycleHooks } from '../lifecycle';
import type { Module } from '../modules';
import { isModule } from '../modules';
import type {
  ClassProviderDefinition,
  FactoryProviderDefinition,
  FamilyMemberRef,
  FamilyProviderDefinition,
  ModuleProvider,
  Provider,
  ProviderDefinition,
  ProvidersFactory,
  TokenFamily,
} from '../providers';
import {
  getAllSentinelFamily,
  getAutoSentinelFamily,
  injectableMetaStorage,
  isClassDefinition,
  isDefinition,
  isFactoryProvider,
  isFamilyDefinition,
  isTokenFamily,
  isValueDefinition,
  lookupFamilyMember,
  suggestFamilyForToken,
} from '../providers';

import { BuiltContainer } from './container.built';

/**
 * Hard bound on the family materialization fixpoint loop.
 *
 * A recipe whose provider depends on a brand new member of the same family
 * would otherwise materialize forever; the bound turns that into a diagnostic.
 */
const MAX_MATERIALIZATION_ROUNDS = 100;

/**
 * What a module declared in its `exports`.
 *
 * Families are kept apart from plain tokens: a family is a function, and running
 * it through `stringifyToken` would export the string `"<familyName>"` instead of
 * the family's members.
 */
interface ModuleExports {
  /** Stringified tokens listed in `exports` */
  tokens: Set<string>;
  /** Names of token families listed in `exports` - all their members are exported */
  families: Set<string>;
}

/**
 * A registered family recipe together with the module that registered it.
 */
interface FamilyRecipeEntry {
  /** Produces the provider definition for one member */
  recipe: (param: string) => ProviderDefinition;
  /** Module the recipe was registered through, if any */
  moduleName?: string;
}

/**
 * Test composition root seam: a graph node substituted by a value.
 *
 * The pair is positional - you can only override a token you hold a reference
 * to. There is no string-addressed form on purpose: it would be a hole in ES
 * visibility and would devalue the kernel/user boundary.
 */
export type TokenOverride<T = unknown> = readonly [
  token: InjectionToken<T>,
  value: T,
];

/**
 * Test composition root seam: the recipe of a whole token family replaced.
 *
 * Shape-identical to `familyProvider(family, recipe)` - the same
 * "family -> recipe" pair, only applied on top of the registered one and
 * strictly before member materialization.
 */
export type FamilyOverrideEntry<
  T = unknown,
  Params extends [param: string] = [param: string],
> = FamilyProviderDefinition<T, Params>;

/**
 * Options of {@link ContainerBuilder}.
 */
export interface ContainerBuilderOptions {
  /**
   * Opt-in build-time lint: every cross-module graph edge must point at a token
   * the owning module lists in `exports`. Off by default; this is a check on the
   * built graph, not runtime encapsulation.
   */
  strictExports?: boolean;

  /**
   * Test composition root seam: graph nodes substituted before instantiation.
   *
   * `assemble` does not forward this option and never will - substitution is a
   * property of a test run, not of a production one. See {@link TokenOverride}.
   */
  overrides?: readonly TokenOverride<any>[];

  /**
   * Test composition root seam: family recipes replaced before members are
   * materialized. See {@link FamilyOverrideEntry}.
   */
  familyOverrides?: readonly FamilyOverrideEntry<any, any>[];
}

/**
 * DI container builder.
 *
 * Responsible for managing dependency injection. Uses providers
 * to create and manage instances.
 *
 * Architecture follows three phases:
 * 1. **Registration**: register all providers and modules
 * 2. **Validation**: check for circular dependencies and duplicates
 * 3. **Build**: instantiate all providers and return a built container
 *
 * @example
 * ```typescript
 * const container = await new ContainerBuilder()
 *   .register(UserService)
 *   .register(DatabaseService)
 *   .build();
 * ```
 */
export class ContainerBuilder {
  readonly #providers = new Map<InjectionToken, ProviderDefinition>();
  readonly #providersFactories = new Map<string, ProvidersFactory>();
  readonly #providerToModule = new Map<InjectionToken, string>();
  readonly #moduleExports = new Map<string, ModuleExports>();
  readonly #familyRecipes = new Map<string, FamilyRecipeEntry>();
  readonly #modules = new Set<string>();
  readonly #strictExports: boolean;
  readonly #overrides: readonly TokenOverride<any>[];
  readonly #familyOverrides: readonly FamilyOverrideEntry<any, any>[];

  #isBuilt = false;

  /**
   * @param options - Builder options; see {@link ContainerBuilderOptions}
   */
  constructor(options: ContainerBuilderOptions = {}) {
    this.#strictExports = options.strictExports ?? false;
    this.#overrides = options.overrides ?? [];
    this.#familyOverrides = options.familyOverrides ?? [];
  }

  /**
   * Unified registration method that accepts providers, family recipes or modules.
   *
   * This is the main entry point for registering dependencies.
   *
   * @param items - Providers, family recipes or modules to register
   * @returns The current builder instance for method chaining
   * @throws {Error} If the container is already built
   *
   * @example
   * ```typescript
   * builder
   *   .register(UserService, DatabaseService)
   *   .register(familyProvider(ILogger, recipe))
   *   .register(userModule)
   *   .build();
   * ```
   */
  register(...items: (ModuleProvider | Module)[]): this {
    if (this.#isBuilt) {
      throw new Error(
        'Cannot register providers or modules after container is built',
      );
    }

    for (const item of items) {
      // Family definitions are checked first: `isModule` recognizes a module by a
      // string `name`, and we never want that heuristic near a family definition.
      if (isFamilyDefinition(item)) {
        this.registerFamilyProvider(item);
      } else if (isModule(item)) {
        this.registerModule(item);
      } else {
        this.registerProvider(item);
      }
    }

    return this;
  }

  /**
   * Builds the container, validating dependencies and instantiating all providers.
   *
   * This method must be called after all providers are registered.
   * Performs the following steps:
   * 1. Expands module provider factories
   * 2. Replaces overridden family recipes - before any member is born
   * 3. Materializes the family members referenced in deps
   * 4. Substitutes overridden nodes by value providers
   * 5. Prunes subtrees orphaned by the substitution
   * 6. Creates a synthetic aggregate node per referenced `Family.all`
   * 7. Reports every dependency left without a provider, at once
   * 8. Instantiates all providers
   * 9. Builds the dependency graph
   * 10. Validates the graph for circular dependencies
   * 11. Lints cross-module edges against `exports` when `strictExports` is on
   *
   * @returns A built container with access to instances
   * @throws {Error} If the container is already built or circular dependencies are detected
   *
   * @example
   * ```typescript
   * const container = await new ContainerBuilder()
   *   .register(UserService)
   *   .build();
   *
   * await container.init();
   * ```
   */
  async build(): Promise<BuiltContainer> {
    if (this.#isBuilt) {
      throw new Error('Container is already built');
    }

    // Step 1: Expand module provider factories into ordinary registrations
    await this.appendFactoryProviders();

    // Step 2: Replace overridden family recipes - strictly before
    // materialization, or members would be born from the production recipe
    this.applyFamilyOverrides();

    // Step 3: Turn referenced family members into ordinary providers
    this.materializeFamilyMembers();

    // Step 4: Substitute overridden nodes, remembering what they used to need
    const dependenciesBeforeOverrides = this.applyOverrides();

    // Step 5: Drop the subtrees the substitution orphaned
    const pruned = this.pruneOrphans(dependenciesBeforeOverrides);

    // Step 6: Turn referenced `.all` sentinels into ordinary aggregate
    // providers - after pruning, so an aggregate is built from the survivors
    this.materializeFamilyAggregates();

    // Step 7: Name every dependency left without a provider, all at once
    this.assertDependenciesSatisfied();

    // Step 8: Instantiate all providers
    const instances = await this.instantiateAll();

    // Step 9: Build dependency graph from instances
    const graph = this.buildDependencyGraph(instances);

    // Step 10: Validate the built graph for circular dependencies
    graph.ensureAcyclic();

    // Step 11: Opt-in visibility lint over the finished graph
    if (this.#strictExports) {
      await this.checkStrictExports(graph);
    }

    this.#isBuilt = true;

    // Return a new BuiltContainer with the graph
    return new BuiltContainer(graph, pruned);
  }

  /**
   * Load a module and all its dependencies.
   * This method handles module imports and registers providers.
   */
  private registerModule(m: Module): void {
    // Check if module is already loaded
    if (this.#modules.has(m.name)) {
      return;
    }

    // Load imported modules first (recursive)
    for (const importedModule of m.imports || []) {
      this.registerModule(importedModule);
    }

    // Сохраняем экспорты модуля
    if (m.exports && m.exports.length > 0) {
      this.#moduleExports.set(m.name, collectModuleExports(m.exports));
    }

    if (typeof m.providers === 'function') {
      this.#providersFactories.set(m.name, m.providers);
    } else {
      for (const provider of m.providers || []) {
        this.registerModuleProvider(provider, m.name);
      }
    }

    // Mark module as loaded
    this.#modules.add(m.name);
  }

  private resolveProvider(
    plainOrCls: ProviderDefinition | Constructor,
  ): ProviderDefinition {
    if (isDefinition(plainOrCls)) {
      return plainOrCls;
    }

    const meta = injectableMetaStorage.get(plainOrCls);
    if (!meta) {
      throw new Error(
        `Class ${plainOrCls.name} is missing @Injectable decorator`,
      );
    }

    return {
      provide: meta.injectionToken,
      useClass: plainOrCls,
      deps: meta.dependencies,
    };
  }

  private getToken<T>(provider: Provider<T>): InjectionToken<T> {
    return isDefinition(provider) ? provider.provide : provider;
  }

  /**
   * Register whatever a module's `providers` may contain: an ordinary provider
   * or a family recipe.
   */
  private registerModuleProvider(
    provider: ModuleProvider,
    moduleName?: string,
  ): void {
    if (isFamilyDefinition(provider)) {
      this.registerFamilyProvider(provider, moduleName);
    } else {
      this.registerProvider(provider, moduleName);
    }
  }

  /**
   * Register the single recipe of a token family.
   *
   * The recipe itself is not a graph node - it has no token of its own. It is
   * kept aside and consulted during materialization on `build()`.
   */
  private registerFamilyProvider(
    definition: FamilyProviderDefinition<any, any>,
    moduleName?: string,
  ): void {
    const familyName = definition.family.familyName;

    if (this.#familyRecipes.has(familyName)) {
      throw new Error(
        `Family provider for token family '${familyName}' is already registered`,
      );
    }

    this.#familyRecipes.set(familyName, {
      recipe: definition.recipe as (param: string) => ProviderDefinition,
      moduleName,
    });
  }

  /**
   * Register a provider in the container
   */
  private registerProvider<T>(
    provider: Provider<T>,
    moduleName?: string,
  ): void {
    const resolvedProvider = this.resolveProvider(provider);
    const token = this.getToken(resolvedProvider);
    const tokenId = stringifyToken(token);

    assertNotAggregateToken(token, tokenId);

    if (this.#providers.has(tokenId)) {
      throw new Error(
        `Provider for token '${stringifyToken(token)}' is already registered`,
      );
    }

    assertNoAutoSentinels(resolvedProvider, tokenId);

    // Store provider metadata for lazy instantiation
    this.#providers.set(tokenId, resolvedProvider);

    // Отслеживаем принадлежность к модулю
    if (moduleName) {
      this.#providerToModule.set(tokenId, moduleName);
    }
  }

  /**
   * Turn every referenced family member into an ordinary provider.
   *
   * Runs after provider factories are expanded and before instantiation: from
   * this point on family members are indistinguishable from hand-registered
   * providers - cycles, lifecycle hooks and module attribution all apply.
   *
   * A provider produced by a recipe may itself depend on family members, so the
   * collection is repeated until a round finds nothing new.
   */
  private materializeFamilyMembers(): void {
    for (let round = 1; ; round++) {
      const pending = this.collectPendingMembers();

      if (pending.size === 0) {
        return;
      }

      if (round > MAX_MATERIALIZATION_ROUNDS) {
        const sample = [...pending.keys()].slice(0, 5).join(', ');
        throw new Error(
          `Family member materialization did not converge after ${MAX_MATERIALIZATION_ROUNDS} rounds - a recipe keeps producing providers that depend on new members. Still pending: ${sample}`,
        );
      }

      for (const [tokenId, ref] of pending) {
        this.materializeMember(tokenId, ref);
      }
    }
  }

  /**
   * Collect family members mentioned in deps of registered providers
   * that have no provider yet.
   */
  private collectPendingMembers(): Map<string, FamilyMemberRef> {
    const pending = new Map<string, FamilyMemberRef>();

    for (const provider of this.#providers.values()) {
      const deps = isValueDefinition(provider) ? [] : provider.deps || [];

      for (const dep of deps) {
        const depId = stringifyToken(dep);

        if (this.#providers.has(depId)) {
          continue;
        }

        const ref = lookupFamilyMember(depId);
        if (ref) {
          pending.set(depId, ref);
        }
      }
    }

    return pending;
  }

  /**
   * Call the family recipe once for a member and register the result.
   */
  private materializeMember(tokenId: string, ref: FamilyMemberRef): void {
    const entry = this.#familyRecipes.get(ref.familyName);

    if (!entry) {
      throw new Error(
        `Member '${tokenId}' of token family '${ref.familyName}' (parameter '${ref.param}') is requested as a dependency, but no familyProvider for family '${ref.familyName}' is registered`,
      );
    }

    let definition: ProviderDefinition;
    try {
      definition = entry.recipe(ref.param);
    } catch (error) {
      throw new Error(
        `Recipe of token family '${ref.familyName}' failed for parameter '${ref.param}'`,
        { cause: error },
      );
    }

    const provided = stringifyToken(definition.provide);
    if (provided !== tokenId) {
      throw new Error(
        `Recipe of token family '${ref.familyName}' for parameter '${ref.param}' returned a provider for token '${provided}', expected '${tokenId}'`,
      );
    }

    this.registerProvider(definition, entry.moduleName);
  }

  /**
   * Turn every referenced `Family.all` into an ordinary aggregate provider.
   *
   * Runs strictly after the member materialization fixpoint - the composition is
   * only known once recipes have stopped producing new members - and before
   * instantiation, so the aggregate is an ordinary node from there on: cycles,
   * topological init/destroy, `toJSON()`, visualization, `strictExports`.
   *
   * No second fixpoint is needed: the deps of an aggregate are tokens that
   * already have providers, so they materialize nothing new.
   */
  private materializeFamilyAggregates(): void {
    const aggregates = new Map<TokenString<unknown>, TokenFamily<any, any>>();

    // Deps-driven, exactly like member materialization: an aggregate nobody
    // asked for would put a node in the graph that nobody requested, and would
    // make the graph depend on which modules happen to be imported.
    for (const provider of this.#providers.values()) {
      const deps = isValueDefinition(provider) ? [] : provider.deps || [];

      for (const dep of deps) {
        const family = getAllSentinelFamily(dep);

        if (family) {
          aggregates.set(stringifyToken(dep), family);
        }
      }
    }

    for (const [tokenId, family] of aggregates) {
      this.#providers.set(tokenId, this.makeAggregateProvider(family));
    }
  }

  /**
   * The provider behind an aggregate node - an ordinary factory provider over
   * the tokens of every registered member of the family.
   *
   * The array is frozen: it is a build snapshot shared by every consumer of
   * `Family.all`, so a mutation by one of them would be visible to the rest.
   * It is registered without a module: consumers may live in several modules
   * while the node is one, so attributing it to any of them would be arbitrary.
   */
  private makeAggregateProvider(
    family: TokenFamily<any, any>,
  ): FactoryProviderDefinition<readonly unknown[]> {
    return {
      provide: family.all,
      useFactory: (...members: unknown[]): readonly unknown[] =>
        Object.freeze(members),
      deps: this.collectFamilyMemberTokens(family.familyName),
    };
  }

  /**
   * Tokens of the registered members of a family, in registration order.
   *
   * `#providers` is insertion-ordered, so this is: explicit contributions in the
   * order their modules and providers were registered, then members produced by
   * the materialization fixpoint, in the order of its rounds. Membership comes
   * from the family registry, never from parsing the token id.
   */
  private collectFamilyMemberTokens(familyName: string): InjectionToken[] {
    const tokens: InjectionToken[] = [];

    for (const token of this.#providers.keys()) {
      const ref = lookupFamilyMember(stringifyToken(token));

      if (ref?.familyName === familyName) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  /**
   * Replace the recipes named by `familyOverrides`.
   *
   * Runs before materialization: a member born from the production recipe
   * could not be un-born, and the whole point of overriding the recipe is that
   * no member is ever produced by it.
   */
  private applyFamilyOverrides(): void {
    const seen = new Set<string>();

    for (const { family, recipe } of this.#familyOverrides) {
      const familyName = family.familyName;

      if (seen.has(familyName)) {
        throw new Error(
          `Token family '${familyName}' is overridden twice - 'last one wins' is not applied; leave a single familyOverride for it`,
        );
      }
      seen.add(familyName);

      // The module of the production recipe is kept: members stay attributed
      // to the module that owns the family, so `strictExports` and the
      // visualization keep naming the same owner.
      const registered = this.#familyRecipes.get(familyName);

      this.#familyRecipes.set(familyName, {
        recipe: recipe as (param: string) => ProviderDefinition,
        moduleName: registered?.moduleName,
      });
    }
  }

  /**
   * Replace the provider of every overridden token by a value provider.
   *
   * Module attribution is untouched: it lives in a separate map keyed by token
   * id, so the graph node keeps naming its owner and `strictExports` keeps
   * linting the same edge.
   *
   * @returns The deps each replaced token had *before* the substitution - the
   * left half of the pruning input
   */
  private applyOverrides(): Map<string, readonly string[]> {
    const before = new Map<string, readonly string[]>();

    for (const [token, value] of this.#overrides) {
      const tokenId = stringifyToken(token);

      if (before.has(tokenId)) {
        throw new Error(
          `Token '${tokenId}' is overridden twice - 'last one wins' is not applied; leave a single override for it`,
        );
      }

      const provider = this.#providers.get(tokenId as InjectionToken);
      if (!provider) {
        throw new Error(
          `Override targets token '${tokenId}', but no provider for it is registered.${overrideMissingHint(
            tokenId,
          )}`,
        );
      }

      before.set(tokenId, dependencyIdsOf(provider));

      this.#providers.set(tokenId as InjectionToken, {
        provide: token,
        useValue: value,
      });
    }

    return before;
  }

  /**
   * Drop the nodes reachable only through the dependencies of a replaced one.
   *
   * The greedy container has no notion of a root - registered means needed -
   * so roots are derived instead: tokens nobody points at in the union of the
   * dependency relations before and after the substitution, plus the tokens
   * unreachable from those (cycle participants, which must reach the cycle
   * detector rather than vanish).
   *
   * The union is what gives the asymmetry we want: a pool the repository used
   * to need is not a root, and after the substitution nobody needs it - so it
   * goes. Without `overrides` the two relations coincide, every node is
   * reachable from the zero-in-degree set, and pruning is the identity.
   *
   * @param before - deps of the replaced tokens as they were before substitution
   * @returns ids of the dropped nodes, in registration order
   */
  private pruneOrphans(
    before: ReadonlyMap<string, readonly string[]>,
  ): string[] {
    const all = [...this.#providers.keys()].map(String);
    const registered = new Set(all);

    const after = new Map<string, readonly string[]>();
    const union = new Map<string, Set<string>>();

    for (const id of all) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const provider = this.#providers.get(id as InjectionToken)!;
      const edges = this.expandAggregateEdges(dependencyIdsOf(provider));

      after.set(id, edges);
      union.set(id, new Set(edges));
    }

    for (const [id, deps] of before) {
      const edges = union.get(id);

      if (edges) {
        for (const dep of this.expandAggregateEdges(deps)) {
          edges.add(dep);
        }
      }
    }

    const pointedAt = new Set<string>();
    for (const deps of union.values()) {
      for (const dep of deps) {
        pointedAt.add(dep);
      }
    }

    const roots = all.filter((id) => !pointedAt.has(id));
    const reachedByUnion = reachableFrom(roots, union);
    const seeds = [
      ...roots,
      ...all.filter((id) => !reachedByUnion.has(id) && registered.has(id)),
    ];

    const keep = reachableFrom(seeds, after);

    // A replaced node is never pruned: the test named it explicitly, and a
    // substitution that silently disappeared would be the worst of both worlds
    for (const id of before.keys()) {
      keep.add(id);
    }

    const pruned = all.filter((id) => !keep.has(id));

    for (const id of pruned) {
      this.#providers.delete(id as InjectionToken);
      this.#providerToModule.delete(id as InjectionToken);
    }

    return pruned;
  }

  /**
   * An edge to `Family.all` stands for edges to every member of the family.
   *
   * The aggregate node itself does not exist yet during pruning (it is created
   * from the survivors afterwards), so without this expansion a consumer of
   * `Family.all` would lose exactly the members it asked for.
   */
  private expandAggregateEdges(deps: readonly string[]): readonly string[] {
    const expanded: string[] = [];

    for (const dep of deps) {
      const family = getAllSentinelFamily(dep as InjectionToken);

      if (family) {
        for (const token of this.collectFamilyMemberTokens(family.familyName)) {
          expanded.push(stringifyToken(token));
        }
      } else {
        expanded.push(dep);
      }
    }

    return expanded;
  }

  /**
   * Report every dependency left without a provider - before instantiation.
   *
   * Instantiation fails on the first missing token it happens to reach, which
   * makes "stub every unsatisfied import" an exercise in re-running the test.
   * Same style as `checkStrictExports`: a strict build tells the whole story.
   */
  private assertDependenciesSatisfied(): void {
    const missing = new Map<string, string[]>();

    for (const [token, provider] of this.#providers) {
      for (const dep of dependencyIdsOf(provider)) {
        if (this.#providers.has(dep as InjectionToken)) {
          continue;
        }

        const consumers = missing.get(dep);
        if (consumers) {
          consumers.push(String(token));
        } else {
          missing.set(dep, [String(token)]);
        }
      }
    }

    if (missing.size === 0) {
      return;
    }

    const lines = [...missing].map(
      ([dep, consumers]) =>
        `  - '${dep}' required by ${consumers
          .map((consumer) => `'${consumer}'`)
          .join(', ')}${familyHint(dep)}`,
    );

    throw new Error(
      `Unsatisfied dependencies (${missing.size}):\n${lines.join(
        '\n',
      )}\nRegister a provider for each of them (in 'providers:' of a module, or via register()).`,
    );
  }

  /**
   * Create instance from ClassProvider
   */
  private createClassInstance(
    provider: ClassProviderDefinition,
    instances: Map<InjectionToken, unknown>,
  ): unknown {
    const deps = provider.deps || [];
    const args = deps.map((dep) => instances.get(stringifyToken(dep)));

    return new provider.useClass(...args);
  }

  /**
   * Create instance from any provider type
   */
  private async createInstance(
    provider: ProviderDefinition,
    instances: Map<InjectionToken, unknown>,
  ): Promise<unknown> {
    if (isClassDefinition(provider)) {
      return this.createClassInstance(provider, instances);
    } else if (isValueDefinition(provider)) {
      return provider.useValue;
    } else if (isFactoryProvider(provider)) {
      const args = provider.deps.map((dep) =>
        instances.get(stringifyToken(dep)),
      );
      return await provider.useFactory(...args);
    } else {
      throw new Error('Unknown provider type');
    }
  }

  private async appendFactoryProviders(): Promise<void> {
    for (const [moduleName, factory] of this.#providersFactories.entries()) {
      const providers = await factory();
      for (const provider of providers) {
        this.registerModuleProvider(provider, moduleName);
      }
    }
  }

  /**
   * Instantiate all providers in dependency order
   */
  private async instantiateAll(): Promise<Map<InjectionToken, unknown>> {
    const instances = new Map<InjectionToken, unknown>();
    const visited = new Set<InjectionToken>();
    const instantiating = new Set<InjectionToken>();

    const instantiateOne = async (token: InjectionToken): Promise<void> => {
      if (instances.has(token)) {
        return;
      }

      if (instantiating.has(token)) {
        // `instantiating` is a depth-first stack, so its tail from the repeated
        // token onwards is the cycle itself. Spelling it out matters for nodes
        // the user never wrote by hand - a family aggregate, for one.
        throw new Error(
          `Circular dependency detected while instantiating '${String(token)}': ${cyclePath(
            instantiating,
            token,
          )}`,
        );
      }

      instantiating.add(token);

      const provider = this.#providers.get(token);
      if (!provider) {
        throw new Error(
          `Provider for token '${token}' not found${familyHint(String(token))}`,
        );
      }

      if (!isValueDefinition(provider)) {
        for (const dep of provider.deps || []) {
          await instantiateOne(stringifyToken(dep));
        }
      }

      // Create instance
      const instance = await this.createInstance(provider, instances);
      instances.set(token, instance);

      instantiating.delete(token);
      visited.add(token);
    };

    // Instantiate all providers
    for (const tokenId of this.#providers.keys()) {
      await instantiateOne(tokenId);
    }

    return instances;
  }

  /**
   * Build dependency graph from instantiated providers
   */
  private buildDependencyGraph(
    instances: Map<InjectionToken, unknown>,
  ): DIGraph {
    const graph = new DIGraph();
    const nodes = new Map<string, DINode>();

    // Prepare all node data first
    const nodeData = new Map<string, DINodeData>();

    // First pass: collect all node information
    for (const [token, instance] of instances) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const provider = this.#providers.get(token)!;
      const moduleName = this.#providerToModule.get(token);

      const hooks = getLifecycleHooks(instance);

      const metadata: DINodeMetadata = {
        module: moduleName,
        exported: moduleName
          ? this.computeExported(moduleName, stringifyToken(token))
          : undefined,
      };

      const deps = isValueDefinition(provider)
        ? []
        : (provider.deps || []).map((dep) => stringifyToken(dep));

      nodeData.set(stringifyToken(token), {
        instance,
        metadata,
        hooks,
        deps,
      });
    }

    // Second pass: create nodes with dependencies

    // Create nodes in topological order to ensure dependencies exist
    const visited = new Set<string>();
    const creating = new Set<string>();

    const createRecursive = (id: string): DINode => {
      if (nodes.has(id)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return nodes.get(id)!;
      }

      if (creating.has(id)) {
        throw new Error(
          `Circular dependency detected during node creation: ${id}`,
        );
      }

      creating.add(id);

      const data = nodeData.get(id);
      if (!data) {
        throw new Error(`Node data not found for token: ${id}`);
      }

      const dependencies = data.deps.map(createRecursive);

      const node = new DINode(id, dependencies, data);

      graph.addNode(node);

      nodes.set(id, node);
      creating.delete(id);
      visited.add(id);

      return node;
    };

    for (const tokenId of nodeData.keys()) {
      if (!visited.has(tokenId)) {
        createRecursive(tokenId);
      }
    }

    return graph;
  }

  /**
   * Value of `metadata.exported` for a node owned by a module.
   *
   * A module that declared no `exports` at all keeps the historical
   * `undefined` - "nothing was said" rather than "nothing is exported".
   */
  private computeExported(
    moduleName: string,
    tokenId: string,
  ): boolean | undefined {
    if (!this.#moduleExports.has(moduleName)) {
      return undefined;
    }

    return this.isExportedFrom(moduleName, tokenId);
  }

  /**
   * Does the module export this token, either directly or through a family?
   *
   * A missing or empty `exports` means nothing is exported.
   */
  private isExportedFrom(moduleName: string, tokenId: string): boolean {
    const exports = this.#moduleExports.get(moduleName);
    if (!exports) {
      return false;
    }

    if (exports.tokens.has(tokenId)) {
      return true;
    }

    const member = lookupFamilyMember(tokenId);

    return member !== undefined && exports.families.has(member.familyName);
  }

  /**
   * Opt-in lint of the finished graph: a dependency owned by module M may only
   * be consumed from outside M when M exports its token.
   *
   * Intra-module edges and dependencies without a module are always allowed.
   * All violations are reported at once - a strict build should tell you the
   * whole story, not the first line of it.
   */
  private async checkStrictExports(graph: DIGraph): Promise<void> {
    const violations: string[] = [];

    await graph.traverse((node) => {
      for (const dependency of node.dependencies) {
        const owner = dependency.metadata.module;

        if (!owner || owner === node.metadata.module) {
          continue;
        }

        if (!this.isExportedFrom(owner, dependency.id)) {
          violations.push(`${node.id} → ${dependency.id} (${owner})`);
        }
      }
    });

    if (violations.length > 0) {
      throw new Error(
        `strictExports: dependencies on tokens not exported by their module:\n${violations
          .map((violation) => `  - ${violation}`)
          .join('\n')}`,
      );
    }
  }
}

/**
 * Dependency token ids of a provider; a value provider depends on nothing.
 */
const dependencyIdsOf = (provider: ProviderDefinition): readonly string[] =>
  isValueDefinition(provider)
    ? []
    : (provider.deps || []).map((dep) => stringifyToken(dep));

/**
 * Tokens reachable from `seeds` over `relation`, seeds included.
 */
const reachableFrom = (
  seeds: readonly string[],
  relation: ReadonlyMap<string, Iterable<string>>,
): Set<string> => {
  const reached = new Set<string>();
  const queue = [...seeds];

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = queue.pop()!;

    if (reached.has(id)) {
      continue;
    }
    reached.add(id);

    for (const dep of relation.get(id) ?? []) {
      if (!reached.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return reached;
};

/**
 * Why an override found nothing to replace.
 *
 * A member token is the interesting case: it becomes a graph node only once
 * something injects it, so "not registered" reads as a typo when it is really
 * "nobody asked for this member".
 */
const overrideMissingHint = (tokenId: string): string => {
  const member = lookupFamilyMember(tokenId);

  if (member) {
    return ` It is a member of token family '${member.familyName}': a member token becomes a graph node only once something injects it. Override the family recipe instead (familyOverride) or override a member that is actually injected.`;
  }

  return ` Check that it is registered by the modules and features this application selected.`;
};

/**
 * Split a module's `exports` into plain tokens and whole families.
 */
const collectModuleExports = (
  declared: NonNullable<Module['exports']>,
): ModuleExports => {
  const tokens = new Set<string>();
  const families = new Set<string>();

  for (const item of declared) {
    if (isTokenFamily(item)) {
      families.add(item.familyName);
    } else {
      tokens.add(stringifyToken(item));
    }
  }

  return { tokens, families };
};

/**
 * `Family.auto` only makes sense where a consumer class exists. Anywhere else
 * the sentinel would have no name to resolve against, so we reject it early.
 */
const assertNoAutoSentinels = (
  provider: ProviderDefinition,
  tokenId: string,
): void => {
  const deps = isValueDefinition(provider) ? [] : provider.deps || [];

  for (const dep of deps) {
    const family = getAutoSentinelFamily(dep);

    if (family) {
      throw new Error(
        `'${family.familyName}.auto' is only allowed in deps of a class decorated with @Injectable, but it appeared in deps of provider '${tokenId}'. Use an explicit '${family.familyName}('<name>')' member token instead`,
      );
    }
  }
};

/**
 * Renders the cycle closed by re-entering `token`: the tail of the
 * instantiation stack from that token onwards, plus the token again.
 */
const cyclePath = (
  instantiating: ReadonlySet<InjectionToken>,
  token: InjectionToken,
): string => {
  const stack = [...instantiating].map(String);
  const start = stack.indexOf(String(token));

  return [...stack.slice(start), String(token)].join(' → ');
};

/**
 * `Family.all` names the node the builder itself creates on `build()`.
 *
 * Letting a hand-registered provider win would give one node two sources of
 * truth - sometimes the graph, sometimes the registration. Substituting the
 * composition in tests gets its own explicit path instead.
 *
 * Every registration path goes through `registerProvider`, so this covers a
 * direct `register()`, a module's `providers` (array or factory) and anything a
 * family recipe returns.
 */
const assertNotAggregateToken = (
  token: InjectionToken,
  tokenId: string,
): void => {
  const family = getAllSentinelFamily(token);

  if (family) {
    throw new Error(
      `Token '${tokenId}' is reserved for the aggregate node of token family '${family.familyName}' and cannot be provided by hand. Contribute to the family with a member token, e.g. ${family.familyName}('<param>')`,
    );
  }
};

/**
 * Extra hint for a token that looks like a family member but was not created by
 * the family (typically built with `makeToken` by hand).
 */
const familyHint = (tokenId: string): string => {
  const familyName = suggestFamilyForToken(tokenId);

  return familyName
    ? `. It looks like a member of token family '${familyName}' - family members must be created by calling the family, e.g. ${familyName}('<param>')`
    : '';
};
