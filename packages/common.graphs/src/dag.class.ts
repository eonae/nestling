import type { INode } from './interfaces';

/**
 * Направление обхода графа зависимостей
 */
export type TraversalDirection = 'topological' | 'reverse-topological';

/**
 * Опции для обхода графа
 */
export interface VisitOptions<T extends INode<T>> {
  /** Функция фильтрации узлов */
  filter?: (node: Readonly<T>) => boolean;
  /** Направление обхода */
  direction?: TraversalDirection;
}

/**
 * Callback функция для обхода узлов
 */
export type VisitCallback<T extends INode<T>> = (
  node: Readonly<T>,
) => void | Promise<void>;

/**
 * Граф зависимостей для управления экземплярами сервисов
 */
export class DAG<T extends INode<T>> {
  private readonly nodes = new Map<string, T>();

  /**
   * Добавляет узел в граф
   */
  addNode(node: T): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`DI node for token '${node.id}' already exists`);
    }

    this.nodes.set(node.id, node);
  }

  /**
   * Получает узел по id
   */
  getNode(id: string): T | undefined {
    return this.nodes.get(id);
  }

  /**
   * Обходит граф с заданными опциями
   */
  async traverse(
    callback: VisitCallback<T>,
    options: VisitOptions<T> = {},
  ): Promise<void> {
    const { filter, direction = 'topological' } = options;

    const shouldVisit = (node: T): boolean => {
      return !filter || filter(node);
    };

    await (direction === 'topological'
      ? this.topologicalTraversal(callback, shouldVisit)
      : this.reverseTopologicalTraversal(callback, shouldVisit));
  }

  /**
   * Валидирует граф на отсутствие циклических зависимостей
   * Выбрасывает ошибку со всеми найденными циклами
   */
  ensureAcyclic(): void {
    const cycles = this.findAllCycles();

    if (cycles.length > 0) {
      const cycleDescriptions = cycles
        .map((cycle, index) => `Cycle ${index + 1}: ${cycle.join(' → ')}`)
        .join('\n');

      throw new Error(`Cycles detected in the graph:\n${cycleDescriptions}`);
    }
  }

  /**
   * Топологическая сортировка (алгоритм Кана)
   * Порядок: от узлов без зависимостей к узлам с зависимостями
   * Подходит для порядка инстанцирования
   */
  private async topologicalTraversal(
    visitNode: (node: T) => void | Promise<void>,
    shouldVisit: (node: T) => boolean,
  ): Promise<void> {
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();
    const queue: T[] = [];

    // Подсчитываем входящие степени для всех узлов
    for (const node of this.nodes.values()) {
      if (shouldVisit(node)) {
        inDegree.set(node.id, node.dependencies.length);

        // Узлы без зависимостей добавляем в очередь
        if (node.dependencies.length === 0) {
          queue.push(node);
        }
      }
    }

    // Обрабатываем узлы в топологическом порядке
    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const node = queue.shift()!;

      if (visited.has(node.id)) {
        continue;
      }

      visited.add(node.id);
      await visitNode(node);

      // Уменьшаем входящие степени для зависимых узлов
      const dependents = this.getDependents(node);
      for (const dependent of dependents) {
        if (!shouldVisit(dependent)) {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const currentInDegree = inDegree.get(dependent.id)! - 1;
        inDegree.set(dependent.id, currentInDegree);

        // Если все зависимости обработаны, добавляем в очередь
        if (currentInDegree === 0) {
          queue.push(dependent);
        }
      }
    }
  }

  /**
   * Обратная топологическая сортировка
   * Порядок: от узлов с зависимостями к узлам без зависимостей
   * Подходит для порядка уничтожения (cleanup)
   */
  private async reverseTopologicalTraversal(
    visitNode: (node: T) => void | Promise<void>,
    shouldVisit: (node: T) => boolean,
  ): Promise<void> {
    const visited = new Set<string>();
    const outDegree = new Map<string, number>();
    const queue: T[] = [];

    // Подсчитываем исходящие степени для всех узлов
    for (const node of this.nodes.values()) {
      if (shouldVisit(node)) {
        const dependents = this.getDependents(node);
        outDegree.set(node.id, dependents.length);

        // Узлы без зависимых (листья) добавляем в очередь
        if (dependents.length === 0) {
          queue.push(node);
        }
      }
    }

    // Обрабатываем узлы в обратном топологическом порядке
    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const node = queue.shift()!;

      if (visited.has(node.id)) {
        continue;
      }

      visited.add(node.id);
      await visitNode(node);

      // Уменьшаем исходящие степени для узлов-зависимостей
      for (const dependency of node.dependencies) {
        if (!shouldVisit(dependency)) {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const currentOutDegree = outDegree.get(dependency.id)! - 1;
        outDegree.set(dependency.id, currentOutDegree);

        // Если все зависимые обработаны, добавляем в очередь
        if (currentOutDegree === 0) {
          queue.push(dependency);
        }
      }
    }
  }

  /**
   * Получает узлы, которые зависят от указанного узла
   */
  private getDependents(node: T): readonly T[] {
    const dependents: T[] = [];

    for (const otherNode of this.nodes.values()) {
      if (otherNode.dependencies.includes(node)) {
        dependents.push(otherNode);
      }
    }

    return dependents;
  }

  /**
   * Находит все циклы в графе
   * Возвращает массив циклов, где каждый цикл - это массив tokenId
   */
  private findAllCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (nodeId: string): void => {
      if (recursionStack.has(nodeId)) {
        // Найден цикл - извлекаем его из pathStack
        const cycleStartIndex = pathStack.indexOf(nodeId);
        const cycle = pathStack.slice(cycleStartIndex);
        cycle.push(nodeId); // Замыкаем цикл
        cycles.push([...cycle]);
        return;
      }

      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      pathStack.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const dependency of node.dependencies) {
          dfs(dependency.id);
        }
      }

      recursionStack.delete(nodeId);
      pathStack.pop();
    };

    // Проверяем все узлы как потенциальные точки входа
    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }
}
