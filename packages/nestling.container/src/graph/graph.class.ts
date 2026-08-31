import type { DINode } from './node.class';

import { DAG } from '@common/graphs';

/** Узел графа зависимостей в виде JSON. */
export interface JsonDINode {
  /** Идентификатор токена */
  id: string;
  /** Метаданные узла */
  metadata: {
    /** Имя модуля, если провайдер принадлежит модулю */
    module?: string;
  };
  /** Идентификаторы зависимостей */
  dependencies: string[];
}

/** Граф зависимостей целиком в виде JSON. */
export interface JsonDIGraph {
  /** Все узлы графа */
  nodes: JsonDINode[];
}

/** Граф зависимостей: ориентированный ациклический граф из `DINode`. */
export class DIGraph extends DAG<DINode> {
  /**
   * Возвращает граф в виде JSON.
   *
   * @returns JSON-представление графа
   */
  async toJSON(): Promise<JsonDIGraph> {
    const nodes: JsonDINode[] = [];

    await this.traverse(({ id, metadata, dependencies }) => {
      const jsonNode: JsonDINode = {
        id,
        metadata: { module: metadata.module },
        dependencies: dependencies.map((dep) => dep.id),
      };

      nodes.push(jsonNode);
    });

    return { nodes };
  }
}
