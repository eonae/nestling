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
  isValueDefinition,
  lookupFamilyMember,
  suggestFamilyForToken,
} from '../providers';

import { BuiltContainer } from './container.built';

/**
 * Предел числа раундов создания членов семейств в `build()`.
 *
 * Рецепт, чей провайдер зависит от нового члена того же семейства, порождал
 * бы членов бесконечно; предел превращает это в ошибку сборки.
 */
const MAX_MATERIALIZATION_ROUNDS = 100;

/** Зарегистрированный рецепт семейства и модуль, через который он пришёл. */
interface FamilyRecipeEntry {
  /** Возвращает определение провайдера для одного члена */
  recipe: (param: string) => ProviderDefinition;
  /** Модуль, зарегистрировавший рецепт, если он есть */
  moduleName?: string;
}

/**
 * Подстановка узла графа значением в тестовой сборке.
 *
 * Пара позиционная: подменить можно только токен, на который есть ссылка.
 * Формы с адресом-строкой нет: она обходила бы видимость ES-модулей.
 */
export type TokenOverride<T = unknown> = readonly [
  token: InjectionToken<T>,
  value: T,
];

/**
 * Подмена рецепта целого семейства токенов в тестовой сборке.
 *
 * Та же пара семейства и рецепта, что у `familyProvider(family, recipe)`.
 * Применяется поверх зарегистрированного рецепта и строго до создания
 * членов.
 */
export type FamilyOverrideEntry<
  T = unknown,
  Params extends [param: string] = [param: string],
> = FamilyProviderDefinition<T, Params>;

/** Опции {@link ContainerBuilder}. */
export interface ContainerBuilderOptions {
  /**
   * Узлы графа, подменяемые значениями до создания экземпляров.
   * Поле тестовой сборки: `assemble` его не передаёт.
   * См. {@link TokenOverride}.
   */
  overrides?: readonly TokenOverride<any>[];

  /**
   * Рецепты семейств, подменяемые до создания членов.
   * См. {@link FamilyOverrideEntry}.
   */
  familyOverrides?: readonly FamilyOverrideEntry<any, any>[];
}

/**
 * Билдер контейнера.
 *
 * Принимает провайдеры, рецепты семейств и модули через `register()`, а в
 * `build()` проверяет граф и создаёт все экземпляры сразу.
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
  readonly #familyRecipes = new Map<string, FamilyRecipeEntry>();
  readonly #modules = new Map<string, Module>();
  readonly #overrides: readonly TokenOverride<any>[];
  readonly #familyOverrides: readonly FamilyOverrideEntry<any, any>[];

  #isBuilt = false;

  /**
   * @param options - Опции билдера; см. {@link ContainerBuilderOptions}
   */
  constructor(options: ContainerBuilderOptions = {}) {
    this.#overrides = options.overrides ?? [];
    this.#familyOverrides = options.familyOverrides ?? [];
  }

  /**
   * Регистрирует провайдеры, рецепты семейств и модули.
   *
   * @param items - Провайдеры, рецепты семейств или модули
   * @returns Тот же билдер, для цепочки вызовов
   * @throws {Error} Если контейнер уже собран
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
      // Сначала рецепт семейства: `isModule` узнаёт модуль по строковому
      // `name`, и эта проверка не должна видеть определение семейства.
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
   * Собирает контейнер: проверяет зависимости и создаёт все экземпляры.
   *
   * Вызывается один раз после регистрации. Шаги:
   * 1. разворачивает фабрики провайдеров модулей;
   * 2. подменяет рецепты семейств из `familyOverrides` — до создания членов;
   * 3. создаёт членов семейств, упомянутых в зависимостях;
   * 4. подменяет узлы из `overrides` провайдерами-значениями;
   * 5. удаляет поддеревья, осиротевшие после подмены;
   * 6. создаёт узел-агрегат для каждого упомянутого `Family.all`;
   * 7. перечисляет все зависимости без провайдера одной ошибкой;
   * 8. создаёт экземпляры;
   * 9. строит граф зависимостей;
   * 10. проверяет граф на циклы.
   *
   * @returns Собранный контейнер с доступом к экземплярам
   * @throws {Error} Если контейнер уже собран или найден цикл
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

    // Шаг 1: развернуть фабрики провайдеров модулей в обычные регистрации
    await this.appendFactoryProviders();

    // Шаг 2: подменить рецепты семейств — строго до создания членов, иначе
    // члены создались бы по боевому рецепту
    this.applyFamilyOverrides();

    // Шаг 3: превратить упомянутых членов семейств в обычные провайдеры
    this.materializeFamilyMembers();

    // Шаг 4: подменить узлы из `overrides`, запомнив их прежние зависимости
    const dependenciesBeforeOverrides = this.applyOverrides();

    // Шаг 5: удалить поддеревья, осиротевшие после подмены
    const pruned = this.pruneOrphans(dependenciesBeforeOverrides);

    // Шаг 6: превратить упомянутые `.all` в провайдеры-агрегаты — после
    // прунинга, чтобы агрегат собрался из оставшихся членов
    this.materializeFamilyAggregates();

    // Шаг 7: перечислить все зависимости без провайдера одной ошибкой
    this.assertDependenciesSatisfied();

    // Шаг 8: создать экземпляры
    const instances = await this.instantiateAll();

    // Шаг 9: построить граф зависимостей из экземпляров
    const graph = this.buildDependencyGraph(instances);

    // Шаг 10: проверить граф на циклы
    graph.ensureAcyclic();

    this.#isBuilt = true;

    return new BuiltContainer(graph, pruned);
  }

  /**
   * Регистрирует модуль вместе с его импортами.
   *
   * Идентичность модуля — ссылочная. То же значение, встреченное повторно
   * (через `imports`, через корень и фичу, через две фичи с общим
   * инфраструктурным модулем), пропускается. Другое значение под занятым
   * именем — ошибка: имя привязывает провайдеры и экспорты к модулю, и
   * молчаливый пропуск второго значения потерял бы его провайдеры.
   */
  private registerModule(m: Module): void {
    const loaded = this.#modules.get(m.name);

    if (loaded) {
      if (loaded !== m) {
        throw new Error(moduleNameCollisionMessage(m.name));
      }

      return;
    }

    // Модуль помечается загруженным до обхода `imports`: цикл импортов
    // должен завершить обход, а не войти в него снова
    this.#modules.set(m.name, m);

    for (const importedModule of m.imports || []) {
      this.registerModule(importedModule);
    }

    if (typeof m.providers === 'function') {
      this.#providersFactories.set(m.name, m.providers);
    } else {
      for (const provider of m.providers || []) {
        this.registerModuleProvider(provider, m.name);
      }
    }
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
   * Регистрирует элемент `providers` модуля: обычный провайдер или рецепт
   * семейства.
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
   * Регистрирует единственный рецепт семейства токенов.
   *
   * Сам рецепт — не узел графа, у него нет своего токена. Он хранится
   * отдельно и используется при создании членов в `build()`.
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

  /** Регистрирует провайдер. */
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

    this.#providers.set(tokenId, resolvedProvider);

    if (moduleName) {
      this.#providerToModule.set(tokenId, moduleName);
    }
  }

  /**
   * Превращает каждого упомянутого члена семейства в обычный провайдер.
   *
   * Выполняется после разворачивания фабрик и до создания экземпляров.
   * С этого момента члены семейств неотличимы от провайдеров,
   * зарегистрированных вручную: циклы, хуки жизненного цикла и привязка к
   * модулю работают для них так же.
   *
   * Провайдер, который вернул рецепт, сам может зависеть от членов
   * семейств, поэтому сбор повторяется, пока раунд находит новых.
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
   * Собирает членов семейств, упомянутых в зависимостях провайдеров, у
   * которых ещё нет провайдера.
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

  /** Вызывает рецепт семейства для одного члена и регистрирует результат. */
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
   * Превращает каждый упомянутый `Family.all` в обычный провайдер-агрегат.
   *
   * Выполняется строго после создания членов (состав известен, только когда
   * рецепты перестали порождать новых) и до создания экземпляров. Дальше
   * агрегат — обычный узел: циклы, топологический порядок хуков,
   * `toJSON()`, визуализация.
   *
   * Повторять сбор членов после этого шага не нужно: зависимости агрегата —
   * токены, у которых провайдеры уже есть.
   */
  private materializeFamilyAggregates(): void {
    const aggregates = new Map<TokenString<unknown>, TokenFamily<any, any>>();

    // Только по зависимостям, как и члены семейств: агрегат, которого никто
    // не запросил, добавил бы в граф лишний узел, зависящий от того, какие
    // модули оказались импортированы.
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
   * Возвращает провайдер узла-агрегата: фабрику над токенами всех
   * зарегистрированных членов семейства.
   *
   * Массив заморожен: это снимок сборки, общий для всех потребителей
   * `Family.all`, и изменение одним из них было бы видно остальным.
   * Модуля у агрегата нет: потребители могут жить в нескольких модулях,
   * а узел один, и любая привязка была бы произвольной.
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
   * Возвращает токены зарегистрированных членов семейства в порядке
   * регистрации.
   *
   * `#providers` хранит порядок вставки, поэтому сначала идут явные
   * провайдеры в порядке регистрации модулей, затем члены, созданные
   * рецептом, в порядке раундов. Членство берётся из реестра семейства,
   * а не из разбора идентификатора токена.
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
   * Подменяет рецепты, перечисленные в `familyOverrides`.
   *
   * Выполняется до создания членов: члена, созданного боевым рецептом, уже
   * не отменить, а смысл подмены рецепта в том, чтобы боевой не создал ни
   * одного.
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

      // Модуль боевого рецепта сохраняется: члены остаются привязаны к
      // модулю-владельцу семейства, и визуализация показывает того же
      // владельца.
      const registered = this.#familyRecipes.get(familyName);

      this.#familyRecipes.set(familyName, {
        recipe: recipe as (param: string) => ProviderDefinition,
        moduleName: registered?.moduleName,
      });
    }
  }

  /**
   * Подменяет провайдер каждого токена из `overrides` провайдером-значением.
   *
   * Привязка к модулю не меняется: она хранится в отдельной карте по
   * идентификатору токена, поэтому узел графа сохраняет владельца.
   *
   * @returns Зависимости каждого подменённого токена до подмены — первая
   * половина входа для прунинга
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
   * Удаляет узлы, достижимые только через зависимости подменённого узла.
   *
   * У жадного контейнера нет понятия корня (зарегистрирован — значит
   * нужен), поэтому корни вычисляются: токены, на которые никто не
   * ссылается в объединении отношений зависимости до и после подмены, плюс
   * токены, недостижимые из этих корней (участники циклов: они должны
   * дойти до проверки циклов, а не исчезнуть).
   *
   * Объединение даёт нужную асимметрию: пул, который был нужен
   * репозиторию, не становится корнем, а после подмены не нужен никому и
   * удаляется. Без `overrides` оба отношения совпадают, каждый узел
   * достижим из корней, и прунинг ничего не меняет.
   *
   * @param before - Зависимости подменённых токенов до подмены
   * @returns Идентификаторы удалённых узлов в порядке регистрации
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

    // Подменённый узел не удаляется никогда: тест назвал его явно, и
    // подмена, которая молча исчезла, была бы хуже всего
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
   * Разворачивает ребро на `Family.all` в рёбра ко всем членам семейства.
   *
   * Во время прунинга узла-агрегата ещё нет (он создаётся из оставшихся
   * членов после), поэтому без разворачивания потребитель `Family.all`
   * потерял бы ровно тех членов, которых запросил.
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
   * Перечисляет все зависимости без провайдера одной ошибкой — до создания
   * экземпляров.
   *
   * Создание экземпляров упало бы на первом же отсутствующем токене, и
   * зависимости пришлось бы чинить по одной за перезапуск. Как и
   * `checkStrictExports`, строгая сборка сообщает всё сразу.
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

  /** Создаёт экземпляр по class-провайдеру. */
  private createClassInstance(
    provider: ClassProviderDefinition,
    instances: Map<InjectionToken, unknown>,
  ): unknown {
    const deps = provider.deps || [];
    const args = deps.map((dep) => instances.get(stringifyToken(dep)));

    return new provider.useClass(...args);
  }

  /** Создаёт значение по провайдеру любого вида. */
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

  /** Разворачивает фабрики провайдеров модулей в обычные регистрации. */
  private async appendFactoryProviders(): Promise<void> {
    for (const [moduleName, factory] of this.#providersFactories.entries()) {
      const providers = await factory();
      for (const provider of providers) {
        this.registerModuleProvider(provider, moduleName);
      }
    }
  }

  /** Создаёт экземпляры всех провайдеров в порядке зависимостей. */
  private async instantiateAll(): Promise<Map<InjectionToken, unknown>> {
    const instances = new Map<InjectionToken, unknown>();
    const visited = new Set<InjectionToken>();
    const instantiating = new Set<InjectionToken>();

    const instantiateOne = async (token: InjectionToken): Promise<void> => {
      if (instances.has(token)) {
        return;
      }

      if (instantiating.has(token)) {
        // `instantiating` — стек обхода в глубину, поэтому его хвост от
        // повторённого токена и есть цикл. Полный путь важен для узлов,
        // которых пользователь не писал руками, например агрегата семейства.
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

      const instance = await this.createInstance(provider, instances);
      instances.set(token, instance);

      instantiating.delete(token);
      visited.add(token);
    };

    for (const tokenId of this.#providers.keys()) {
      await instantiateOne(tokenId);
    }

    return instances;
  }

  /** Строит граф зависимостей из созданных экземпляров. */
  private buildDependencyGraph(
    instances: Map<InjectionToken, unknown>,
  ): DIGraph {
    const graph = new DIGraph();
    const nodes = new Map<string, DINode>();

    const nodeData = new Map<string, DINodeData>();

    // Первый проход: данные каждого узла
    for (const [token, instance] of instances) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const provider = this.#providers.get(token)!;
      const moduleName = this.#providerToModule.get(token);

      const hooks = getLifecycleHooks(instance);

      const metadata: DINodeMetadata = { module: moduleName };

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

    // Второй проход: узлы создаются в топологическом порядке, чтобы
    // зависимости существовали раньше зависимых
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
}

/** Идентификаторы зависимостей провайдера; у провайдера-значения их нет. */
const dependencyIdsOf = (provider: ProviderDefinition): readonly string[] =>
  isValueDefinition(provider)
    ? []
    : (provider.deps || []).map((dep) => stringifyToken(dep));

/** Токены, достижимые из `seeds` по `relation`, включая сами `seeds`. */
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
 * Подсказка к ошибке «override не нашёл, что подменять».
 *
 * Отдельный случай — член семейства: он становится узлом графа, только
 * когда кто-то его инжектирует, поэтому «не зарегистрирован» выглядит как
 * опечатка, хотя на самом деле «этого члена никто не запросил».
 */
const overrideMissingHint = (tokenId: string): string => {
  const member = lookupFamilyMember(tokenId);

  if (member) {
    return ` It is a member of token family '${member.familyName}': a member token becomes a graph node only once something injects it. Override the family recipe instead (familyOverride) or override a member that is actually injected.`;
  }

  return ` Check that it is registered by the modules and features this application selected.`;
};

/**
 * Текст ошибки о двух разных значениях модуля под одним именем.
 *
 * Сравнение ссылочное намеренно: правило «одинаковые опции — один модуль»
 * потребовало бы обходить произвольные значения (функции, живые клиенты)
 * на сборке и превратило бы потерю провайдеров в незаметное слияние.
 * Параметризованный модуль разделяют так: создают значение один раз и
 * импортируют его.
 */
const moduleNameCollisionMessage = (name: string): string =>
  `Two different modules are named '${name}'. ` +
  `A module name is the attribution key of its providers, so it must be unique. ` +
  `Either share one module value between its consumers (create it once and import that value), ` +
  `or give the two configurations different names. ` +
  `If neither is the case, check for a duplicated package in your dependencies - ` +
  `two copies give two values of the same module.`;

/**
 * Отклоняет `Family.auto` в зависимостях провайдера без класса-потребителя:
 * там нет имени, по которому можно выбрать члена.
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
 * Строит путь цикла, замкнутого повторным входом в `token`: хвост стека
 * создания экземпляров от этого токена плюс сам токен.
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
 * Отклоняет провайдер, зарегистрированный вручную под токеном `Family.all`.
 *
 * Этот узел билдер создаёт сам в `build()`. Ручной провайдер дал бы узлу
 * два источника истины: то граф, то регистрация. Для подмены состава
 * агрегата в тестах есть отдельный явный путь.
 *
 * Все пути регистрации проходят через `registerProvider`, поэтому проверка
 * покрывает `register()`, `providers` модуля (массив или фабрику) и
 * результат рецепта семейства.
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
 * Подсказка для токена, который похож на члена семейства, но создан не
 * семейством (обычно вручную через `makeToken`).
 */
const familyHint = (tokenId: string): string => {
  const familyName = suggestFamilyForToken(tokenId);

  return familyName
    ? `. It looks like a member of token family '${familyName}' - family members must be created by calling the family, e.g. ${familyName}('<param>')`
    : '';
};
