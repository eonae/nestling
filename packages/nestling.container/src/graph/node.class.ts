import type { Hook, LifecycleHooks } from '../lifecycle';

import type { INode } from '@common/graphs';

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
  /** Экземпляр провайдера */
  instance: unknown;
  /** Метаданные узла */
  metadata: DINodeMetadata;
  /** Хуки жизненного цикла */
  hooks: LifecycleHooks;
  /** Идентификаторы токенов зависимостей */
  deps: string[];
}

/**
 * Узел графа зависимостей: один экземпляр провайдера с метаданными, хуками
 * и зависимостями.
 */
export class DINode implements INode<DINode> {
  /** Идентификатор токена в строковой форме */
  readonly id: string;
  /** Экземпляр провайдера */
  readonly instance: unknown;
  /** Метаданные узла */
  readonly metadata: DINodeMetadata;
  /** Хуки `@OnInit` экземпляра */
  readonly onInit: readonly Hook[];
  /** Хуки `@OnStart` экземпляра (фаза START, после WIRE) */
  readonly onStart: readonly Hook[];
  /** Хуки `@OnDestroy` экземпляра */
  readonly onDestroy: readonly Hook[];
  /** Зависимости: дочерние узлы */
  readonly dependencies: readonly DINode[];

  constructor(id: string, dependencies: DINode[] = [], data: DINodeData) {
    this.id = id;
    this.instance = data.instance;
    this.metadata = { ...data.metadata };
    this.onInit = [...data.hooks.onInit];
    this.onStart = [...(data.hooks.onStart ?? [])];
    this.onDestroy = [...data.hooks.onDestroy];
    this.dependencies = [...dependencies];
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

  /** Выполняет хуки `@OnInit` узла. */
  async runInitHooks(): Promise<void> {
    for (const hook of this.onInit) {
      await hook();
    }
  }

  /** Выполняет хуки `@OnStart` узла. */
  async runStartHooks(): Promise<void> {
    for (const hook of this.onStart) {
      await hook();
    }
  }

  /** Выполняет хуки `@OnDestroy` узла. */
  async runDestroyHooks(): Promise<void> {
    for (const hook of this.onDestroy) {
      await hook();
    }
  }

  /**
   * Возвращает строку для отладки.
   *
   * @returns Строка вида `DINode(tokenId)`
   */
  toString(): string {
    return `DINode(${this.id})`;
  }
}
