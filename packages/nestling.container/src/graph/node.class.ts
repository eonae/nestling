import type { Hook } from '../lifecycle/index.js';
import { getLifecycleHooks } from '../lifecycle/index.js';
import type { ProviderDefinition } from '../providers/index.js';
import {
  isClassDefinition,
  isFactoryProvider,
  isResourceDefinition,
  isValueDefinition,
} from '../providers/index.js';

import type { INode } from '@nestlingjs/common.graphs';

/** Метаданные узла графа зависимостей. */
export interface DINodeMetadata {
  /** Имя модуля провайдера; `undefined`, если он зарегистрирован без модуля */
  module?: string;
}

/**
 * Данные для создания `DINode`.
 *
 * @internal
 */
export interface DINodeData {
  /** Провайдер: рецепт значения, а не само значение */
  provider: ProviderDefinition;
  /** Метаданные узла */
  metadata: DINodeMetadata;
}

/**
 * Похоже ли значение на промис.
 *
 * Проверяется `then`, а не `instanceof Promise`: фабрика может вернуть
 * промис чужой реализации, и ждать его контейнер всё равно не станет.
 */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

/**
 * Узел графа зависимостей: провайдер с метаданными, рёбрами и слотом
 * значения.
 *
 * Слот пуст до фазы INIT: `build()` строит граф из провайдеров и не
 * создаёт ни одного экземпляра. `instantiate(signal)` заполняет слот —
 * конструктором, значением, фабрикой или `await acquire`.
 */
export class DINode implements INode<DINode> {
  /** Идентификатор DI-токена в строковой форме */
  readonly id: string;
  /** Провайдер узла */
  readonly provider: ProviderDefinition;
  /** Метаданные узла */
  readonly metadata: DINodeMetadata;

  /** Зависимости: дочерние узлы в порядке списка `deps` */
  #dependencies: readonly DINode[] = [];

  /** Значение узла; до INIT слот пуст */
  #value: unknown;
  #created = false;
  #released = false;

  /** Хуки `@OnStart` экземпляра; собираются в момент его создания */
  #onStart: readonly Hook[] = [];

  constructor(id: string, data: DINodeData) {
    this.id = id;
    this.provider = data.provider;
    this.metadata = { ...data.metadata };
  }

  /** Зависимости: дочерние узлы */
  get dependencies(): readonly DINode[] {
    return this.#dependencies;
  }

  /**
   * Связывает узел с его зависимостями.
   *
   * Второй проход построения графа: узлы создаются раньше рёбер, поэтому
   * цикл представим в графе и его ловит `ensureAcyclic()` с полным путём.
   *
   * @param dependencies - Узлы зависимостей в порядке списка `deps`
   * @internal
   */
  linkDependencies(dependencies: readonly DINode[]): void {
    this.#dependencies = [...dependencies];
  }

  /** Значение узла создано: слот заполнен */
  get created(): boolean {
    return this.#created;
  }

  /** Узел захватывает ресурс: его значение освобождается на SHUTDOWN */
  get isResource(): boolean {
    return isResourceDefinition(this.provider);
  }

  /**
   * Значение узла; до `instantiate()` — `undefined`.
   *
   * Читать его напрямую следует только вместе с {@link created}: контракт
   * фазы держит контейнер, а не узел.
   */
  get instance(): unknown {
    return this.#value;
  }

  /** Хуки `@OnStart` узла */
  get onStart(): readonly Hook[] {
    return this.#onStart;
  }

  /**
   * Создаёт значение узла и собирает его хуки `@OnStart`.
   *
   * Повторный вызов ничего не делает: узел создаётся ровно один раз за
   * запуск приложения.
   *
   * @param signal - Сигнал остановки старта; уходит последним аргументом
   * `acquire`
   */
  async instantiate(signal: AbortSignal): Promise<void> {
    if (this.#created) {
      return;
    }

    this.#value = await this.#create(signal);
    this.#created = true;
    this.#onStart = getLifecycleHooks(this.#value).onStart;
  }

  /**
   * Освобождает ресурс узла.
   *
   * Компонент, значение и фабрика освобождать нечего: вызов проходит
   * вхолостую. `release` выполняется ровно один раз, поэтому повторный
   * `destroy()` контейнера его не повторяет.
   */
  async release(): Promise<void> {
    if (!this.#created || this.#released) {
      return;
    }

    const { provider } = this;
    if (!isResourceDefinition(provider)) {
      return;
    }

    this.#released = true;
    await provider.release(this.#value);
  }

  /** Выполняет хуки `@OnStart` узла. */
  async runStartHooks(signal: AbortSignal): Promise<void> {
    for (const hook of this.#onStart) {
      await hook(signal);
    }
  }

  /**
   * Возвращает все транзитивные зависимости узла.
   *
   * @returns Множество узлов, от которых зависит этот узел, без него самого
   */
  getAllDependencies(): Set<DINode> {
    const visited = new Set<DINode>();
    const stack: DINode[] = [this];

    while (stack.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const current = stack.pop()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);
      stack.push(...current.dependencies);
    }

    visited.delete(this);
    return visited;
  }

  /**
   * Возвращает строку для отладки.
   *
   * @returns Строка вида `DINode(tokenId)`
   */
  toString(): string {
    return `DINode(${this.id})`;
  }

  /** Значения зависимостей в порядке списка `deps` */
  #args(): unknown[] {
    return this.#dependencies.map((dependency) => dependency.instance);
  }

  /** Создаёт значение по провайдеру любого вида. */
  async #create(signal: AbortSignal): Promise<unknown> {
    const { provider } = this;

    if (isValueDefinition(provider)) {
      return provider.useValue;
    }

    if (isClassDefinition(provider)) {
      return new provider.useClass(...this.#args());
    }

    if (isResourceDefinition(provider)) {
      return await provider.acquire(...this.#args(), signal);
    }

    if (isFactoryProvider(provider)) {
      const value = provider.useFactory(...this.#args());

      // Тип фабрики `Promise` уже запрещает, но `Module.providers`
      // типизирован значением `unknown`: литерал провайдера с асинхронной
      // фабрикой компилятор пропускает, и ловит его только эта проверка.
      if (isThenable(value)) {
        throw new Error(
          `Factory of provider '${this.id}' returned a Promise, but a factory is synchronous and does no I/O. Declare a resource (resourceProvider or @Resource) to acquire connections instead.`,
        );
      }

      return value;
    }

    throw new Error(`Unknown provider type for '${this.id}'`);
  }
}
