import type { Constructor, InjectionToken } from '../common';
import { tokenId } from '../common';
import type { DINodeData, DINodeMetadata } from '../graph';
import { DIGraph, DINode } from '../graph';
import { getLifecycleHooks } from '../lifecycle';
import type { Module } from '../modules';
import { isModule } from '../modules';
import type {
  ClassProviderDefinition,
  FactoryProviderDefinition,
  FamilyMemberToken,
  FamilyProviderDefinition,
  ModuleProvider,
  Provider,
  ProviderDefinition,
  ProvidersFactory,
  TokenFamily,
} from '../providers';
import {
  asFamilyMember,
  getAllSentinelFamily,
  getAutoSentinelFamily,
  injectableMetaStorage,
  isClassDefinition,
  isDefinition,
  isFactoryProvider,
  isFamilyDefinition,
  isValueDefinition,
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
 * Внутренние карты ключуются **токеном**, а не его идентификатором: два
 * токена с одинаковым `id` — два разных узла графа.
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
  readonly #familyRecipes = new Map<TokenFamily<any, any>, FamilyRecipeEntry>();
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
   * Регистрирует провайдеры с атрибуцией к модулю по имени.
   *
   * Само значение модуля не требуется: имя — метка узлов графа, и
   * провайдер, добавленный сюда, неотличим от перечисленного в
   * `providers:` этого модуля. Так сборка регистрирует класс-хендлер
   * endpoint'а провайдером модуля-объявителя, не меняя значение модуля.
   *
   * @param moduleName - Имя модуля-владельца
   * @param providers - Провайдеры или рецепты семейств
   * @returns Тот же билдер, для цепочки вызовов
   * @throws {Error} Если контейнер уже собран
   */
  registerIn(moduleName: string, ...providers: ModuleProvider[]): this {
    if (this.#isBuilt) {
      throw new Error(
        'Cannot register providers or modules after container is built',
      );
    }

    for (const provider of providers) {
      this.registerModuleProvider(provider, moduleName);
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
    const { graph, nodeIds } = this.buildDependencyGraph(instances);

    // Шаг 10: проверить граф на циклы
    graph.ensureAcyclic();

    this.#isBuilt = true;

    return new BuiltContainer(graph, pruned, nodeIds);
  }

  /**
   * Регистрирует модуль вместе с теми, от которых он зависит.
   *
   * Идентичность модуля — ссылочная. То же значение, встреченное повторно
   * (через `dependsOn`, через корень и фичу, через две фичи с общим
   * инфраструктурным модулем), пропускается. Другое значение под занятым
   * именем — ошибка: имя привязывает провайдеры к модулю, и молчаливый
   * пропуск второго значения потерял бы его провайдеры.
   */
  private registerModule(m: Module): void {
    const loaded = this.#modules.get(m.name);

    if (loaded) {
      if (loaded !== m) {
        throw new Error(moduleNameCollisionMessage(m.name));
      }

      return;
    }

    // Модуль помечается загруженным до обхода `dependsOn`: цикл в поле
    // должен завершить обход, а не войти в него снова
    this.#modules.set(m.name, m);

    for (const required of m.dependsOn || []) {
      this.registerModule(required);
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
    const { family } = definition;

    if (this.#familyRecipes.has(family)) {
      throw new Error(
        `Family provider for token family '${family.familyName}' is already registered`,
      );
    }

    this.#familyRecipes.set(family, {
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

    assertNotAggregateToken(token);

    if (this.#providers.has(token)) {
      throw new Error(
        `Provider for token '${tokenId(token)}' is already registered`,
      );
    }

    assertNoAutoSentinels(resolvedProvider, tokenId(token));

    this.#providers.set(token, resolvedProvider);

    if (moduleName) {
      this.#providerToModule.set(token, moduleName);
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

      if (pending.length === 0) {
        return;
      }

      if (round > MAX_MATERIALIZATION_ROUNDS) {
        const sample = pending
          .slice(0, 5)
          .map((member) => member.id)
          .join(', ');
        throw new Error(
          `Family member materialization did not converge after ${MAX_MATERIALIZATION_ROUNDS} rounds - a recipe keeps producing providers that depend on new members. Still pending: ${sample}`,
        );
      }

      for (const member of pending) {
        this.materializeMember(member);
      }
    }
  }

  /**
   * Собирает членов семейств, упомянутых в зависимостях провайдеров, у
   * которых ещё нет провайдера.
   */
  private collectPendingMembers(): FamilyMemberToken<any>[] {
    const pending = new Set<FamilyMemberToken<any>>();

    for (const provider of this.#providers.values()) {
      const deps = isValueDefinition(provider) ? [] : provider.deps || [];

      for (const dep of deps) {
        if (this.#providers.has(dep)) {
          continue;
        }

        const member = asFamilyMember(dep);
        if (member) {
          pending.add(member);
        }
      }
    }

    return [...pending];
  }

  /** Вызывает рецепт семейства для одного члена и регистрирует результат. */
  private materializeMember(member: FamilyMemberToken<any>): void {
    const { family, param } = member;
    const entry = this.#familyRecipes.get(family);

    if (!entry) {
      throw new Error(
        `Member '${member.id}' of token family '${family.familyName}' (parameter '${param}') is requested as a dependency, but no familyProvider for family '${family.familyName}' is registered`,
      );
    }

    let definition: ProviderDefinition;
    try {
      definition = entry.recipe(param);
    } catch (error) {
      throw new Error(
        `Recipe of token family '${family.familyName}' failed for parameter '${param}'`,
        { cause: error },
      );
    }

    if (definition.provide !== (member as InjectionToken)) {
      throw new Error(
        `Recipe of token family '${family.familyName}' for parameter '${param}' returned a provider for token '${tokenId(definition.provide)}', expected '${member.id}'`,
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
    const aggregates = new Map<InjectionToken, TokenFamily<any, any>>();

    // Только по зависимостям, как и члены семейств: агрегат, которого никто
    // не запросил, добавил бы в граф лишний узел, зависящий от того, какие
    // модули оказались импортированы.
    for (const provider of this.#providers.values()) {
      const deps = isValueDefinition(provider) ? [] : provider.deps || [];

      for (const dep of deps) {
        const family = getAllSentinelFamily(dep);

        if (family) {
          aggregates.set(dep, family);
        }
      }
    }

    for (const [token, family] of aggregates) {
      this.#providers.set(token, this.makeAggregateProvider(family));
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
      deps: this.collectFamilyMemberTokens(family),
    };
  }

  /**
   * Возвращает токены зарегистрированных членов семейства в порядке
   * регистрации.
   *
   * `#providers` хранит порядок вставки, поэтому сначала идут явные
   * провайдеры в порядке регистрации модулей, затем члены, созданные
   * рецептом, в порядке раундов. Членство читается полем токена, а не
   * разбором его идентификатора.
   */
  private collectFamilyMemberTokens(
    family: TokenFamily<any, any>,
  ): InjectionToken[] {
    const tokens: InjectionToken[] = [];

    for (const token of this.#providers.keys()) {
      if (asFamilyMember(token)?.family === family) {
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
    const seen = new Set<TokenFamily<any, any>>();

    for (const { family, recipe } of this.#familyOverrides) {
      if (seen.has(family)) {
        throw new Error(
          `Token family '${family.familyName}' is overridden twice - 'last one wins' is not applied; leave a single familyOverride for it`,
        );
      }
      seen.add(family);

      // Модуль боевого рецепта сохраняется: члены остаются привязаны к
      // модулю-владельцу семейства, и визуализация показывает того же
      // владельца.
      const registered = this.#familyRecipes.get(family);

      this.#familyRecipes.set(family, {
        recipe: recipe as (param: string) => ProviderDefinition,
        moduleName: registered?.moduleName,
      });
    }
  }

  /**
   * Подменяет провайдер каждого токена из `overrides` провайдером-значением.
   *
   * Привязка к модулю не меняется: она хранится в отдельной карте по
   * токену, поэтому узел графа сохраняет владельца.
   *
   * @returns Зависимости каждого подменённого токена до подмены — первая
   * половина входа для прунинга
   */
  private applyOverrides(): Map<InjectionToken, readonly InjectionToken[]> {
    const before = new Map<InjectionToken, readonly InjectionToken[]>();

    for (const [token, value] of this.#overrides) {
      if (before.has(token)) {
        throw new Error(
          `Token '${tokenId(token)}' is overridden twice - 'last one wins' is not applied; leave a single override for it`,
        );
      }

      const provider = this.#providers.get(token);
      if (!provider) {
        throw new Error(
          `Override targets token '${tokenId(token)}', but no provider for it is registered.${overrideMissingHint(
            token,
          )}`,
        );
      }

      before.set(token, dependenciesOf(provider));

      this.#providers.set(token, {
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
    before: ReadonlyMap<InjectionToken, readonly InjectionToken[]>,
  ): string[] {
    const all = [...this.#providers.keys()];

    const after = new Map<InjectionToken, readonly InjectionToken[]>();
    const union = new Map<InjectionToken, Set<InjectionToken>>();

    for (const token of all) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const provider = this.#providers.get(token)!;
      const edges = this.expandAggregateEdges(dependenciesOf(provider));

      after.set(token, edges);
      union.set(token, new Set(edges));
    }

    for (const [token, deps] of before) {
      const edges = union.get(token);

      if (edges) {
        for (const dep of this.expandAggregateEdges(deps)) {
          edges.add(dep);
        }
      }
    }

    const pointedAt = new Set<InjectionToken>();
    for (const deps of union.values()) {
      for (const dep of deps) {
        pointedAt.add(dep);
      }
    }

    const roots = all.filter((token) => !pointedAt.has(token));
    const reachedByUnion = reachableFrom(roots, union);
    const seeds = [...roots, ...all.filter((t) => !reachedByUnion.has(t))];

    const keep = reachableFrom(seeds, after);

    // Подменённый узел не удаляется никогда: тест назвал его явно, и
    // подмена, которая молча исчезла, была бы хуже всего
    for (const token of before.keys()) {
      keep.add(token);
    }

    const pruned = all.filter((token) => !keep.has(token));

    for (const token of pruned) {
      this.#providers.delete(token);
      this.#providerToModule.delete(token);
    }

    return pruned.map((token) => tokenId(token));
  }

  /**
   * Разворачивает ребро на `Family.all` в рёбра ко всем членам семейства.
   *
   * Во время прунинга узла-агрегата ещё нет (он создаётся из оставшихся
   * членов после), поэтому без разворачивания потребитель `Family.all`
   * потерял бы ровно тех членов, которых запросил.
   */
  private expandAggregateEdges(
    deps: readonly InjectionToken[],
  ): readonly InjectionToken[] {
    const expanded: InjectionToken[] = [];

    for (const dep of deps) {
      const family = getAllSentinelFamily(dep);

      if (family) {
        expanded.push(...this.collectFamilyMemberTokens(family));
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
   * зависимости пришлось бы чинить по одной за перезапуск. Строгая сборка
   * сообщает всё сразу.
   */
  private assertDependenciesSatisfied(): void {
    const missing = new Map<InjectionToken, InjectionToken[]>();

    for (const [token, provider] of this.#providers) {
      for (const dep of dependenciesOf(provider)) {
        if (this.#providers.has(dep)) {
          continue;
        }

        const consumers = missing.get(dep);
        if (consumers) {
          consumers.push(token);
        } else {
          missing.set(dep, [token]);
        }
      }
    }

    if (missing.size === 0) {
      return;
    }

    const lines = [...missing].map(
      ([dep, consumers]) =>
        `  - '${tokenId(dep)}' required by ${consumers
          .map((consumer) => `'${tokenId(consumer)}'`)
          .join(', ')}`,
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
    const args = deps.map((dep) => instances.get(dep));

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
      const args = provider.deps.map((dep) => instances.get(dep));
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
          `Circular dependency detected while instantiating '${tokenId(token)}': ${cyclePath(
            instantiating,
            token,
          )}`,
        );
      }

      instantiating.add(token);

      const provider = this.#providers.get(token);
      if (!provider) {
        throw new Error(`Provider for token '${tokenId(token)}' not found`);
      }

      for (const dep of dependenciesOf(provider)) {
        await instantiateOne(dep);
      }

      const instance = await this.createInstance(provider, instances);
      instances.set(token, instance);

      instantiating.delete(token);
    };

    for (const token of this.#providers.keys()) {
      await instantiateOne(token);
    }

    return instances;
  }

  /**
   * Строит граф зависимостей из созданных экземпляров.
   *
   * Узел графа адресуется строкой: она печатается в `toJSON()`, в отчётах
   * и в текстах ошибок. Идентификаторы токенов уникальностью не связаны,
   * поэтому одноимённым узлам добавляется суффикс, а сборка предупреждает
   * о неоднозначности отчётов.
   */
  private buildDependencyGraph(instances: Map<InjectionToken, unknown>): {
    graph: DIGraph;
    nodeIds: ReadonlyMap<InjectionToken, string>;
  } {
    const nodeIds = this.assignNodeIds([...instances.keys()]);

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

      const deps = dependenciesOf(provider).map(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (dep) => nodeIds.get(dep)!,
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      nodeData.set(nodeIds.get(token)!, {
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

    for (const id of nodeData.keys()) {
      if (!visited.has(id)) {
        createRecursive(id);
      }
    }

    return { graph, nodeIds };
  }

  /**
   * Раздаёт узлам графа адреса: обычно это идентификатор токена.
   *
   * Совпадение идентификаторов подмены не вызывает — токены разные, узлы
   * тоже, — но делает отчёты неоднозначными, поэтому второй и следующие
   * узлы получают суффикс, а сборка печатает предупреждение.
   */
  private assignNodeIds(
    tokens: readonly InjectionToken[],
  ): ReadonlyMap<InjectionToken, string> {
    const ids = new Map<InjectionToken, string>();
    const taken = new Map<string, number>();
    const ambiguous: string[] = [];

    for (const token of tokens) {
      const id = tokenId(token);
      const seen = taken.get(id) ?? 0;

      taken.set(id, seen + 1);

      if (seen === 0) {
        ids.set(token, id);
        continue;
      }

      if (seen === 1) {
        ambiguous.push(id);
      }

      ids.set(token, `${id}#${seen + 1}`);
    }

    if (ambiguous.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[nestling] ambiguous token ids: ${ambiguous.join(', ')}. ` +
          `Different tokens share an id, so reports and the dependency graph ` +
          `name them apart with a '#N' suffix. Give each token its own id.`,
      );
    }

    return ids;
  }
}

/** Зависимости провайдера; у провайдера-значения их нет. */
const dependenciesOf = (
  provider: ProviderDefinition,
): readonly InjectionToken[] =>
  isValueDefinition(provider) ? [] : provider.deps || [];

/** Токены, достижимые из `seeds` по `relation`, включая сами `seeds`. */
const reachableFrom = (
  seeds: readonly InjectionToken[],
  relation: ReadonlyMap<InjectionToken, Iterable<InjectionToken>>,
): Set<InjectionToken> => {
  const reached = new Set<InjectionToken>();
  const queue = [...seeds];

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const token = queue.pop()!;

    if (reached.has(token)) {
      continue;
    }
    reached.add(token);

    for (const dep of relation.get(token) ?? []) {
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
const overrideMissingHint = (token: InjectionToken): string => {
  const member = asFamilyMember(token);

  if (member) {
    return ` It is a member of token family '${member.family.familyName}': a member token becomes a graph node only once something injects it. Override the family recipe instead (familyOverride) or override a member that is actually injected.`;
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
  consumerId: string,
): void => {
  for (const dep of dependenciesOf(provider)) {
    const family = getAutoSentinelFamily(dep);

    if (family) {
      throw new Error(
        `'${family.familyName}.auto' is only allowed in deps of a class decorated with @Injectable, but it appeared in deps of provider '${consumerId}'. Use an explicit '${family.familyName}('<name>')' member token instead`,
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
  const stack = [...instantiating];
  const start = stack.indexOf(token);

  return [...stack.slice(start), token].map((t) => tokenId(t)).join(' → ');
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
const assertNotAggregateToken = (token: InjectionToken): void => {
  const family = getAllSentinelFamily(token);

  if (family) {
    throw new Error(
      `Token '${tokenId(token)}' is reserved for the aggregate node of token family '${family.familyName}' and cannot be provided by hand. Contribute to the family with a member token, e.g. ${family.familyName}('<param>')`,
    );
  }
};
