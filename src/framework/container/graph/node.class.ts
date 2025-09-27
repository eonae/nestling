import { Hook, LifecycleHooks } from '../lifecycle';
import { INode } from '../../dag';

/**
 * Метаданные для узла в графе зависимостей
 */
export interface DINodeMetadata {
  /** Имя модуля, откуда этот провайдер получился. Если провайдер зарегистрирован без модуля - undefined */
  module?: string;
  /** true, если в модуле провайдер в exports. Если без модуля - undefined */
  exported?: boolean;
}

export interface DINodeData {
  instance: unknown;
  metadata: DINodeMetadata;
  hooks: LifecycleHooks;
  deps: string[];
}

/**
 * Узел в графе зависимостей
 */
export class DINode implements INode<DINode> {
  /** ID токена в виде строки */
  readonly id: string;
  /** Экземпляр сервиса */
  readonly instance: unknown;
  /** Метаданные узла */
  readonly metadata: DINodeMetadata;
  /** Хуки инициализации для этого экземпляра */
  readonly onInit: ReadonlyArray<Hook>;
  /** Хуки уничтожения для этого экземпляра */
  readonly onDestroy: ReadonlyArray<Hook>;
  /** Зависимости - дочерние узлы */
  readonly dependencies: ReadonlyArray<DINode>;

  constructor(
    id: string,
    dependencies: DINode[] = [],
    data: DINodeData,
  ) {
    this.id = id;
    this.instance = data.instance;
    this.metadata = { ...data.metadata };
    this.onInit = [...data.hooks.onInit];
    this.onDestroy = [...data.hooks.onDestroy];
    this.dependencies = [...dependencies];
  }

  /**
   * Возвращает все зависимости транзитивно (все узлы, от которых зависит этот)
   */
  getAllDependencies(): Set<DINode> {
    const visited = new Set<DINode>();
    const stack: DINode[] = [this];

    while (stack.length > 0) {
      const current = stack.pop()!;
      
      if (visited.has(current)) {
        continue;
      }
      
      visited.add(current);
      stack.push(...current.dependencies);
    }

    visited.delete(this); // Исключаем себя из результата
    return visited;
  }

  /**
   * Выполняет все хуки инициализации для этого узла
   */
  async runInitHooks(): Promise<void> {
    for (const hook of this.onInit) {
      await hook();
    }
  }

  /**
   * Выполняет все хуки уничтожения для этого узла
   */
  async runDestroyHooks(): Promise<void> {
    for (const hook of this.onDestroy) {
      await hook();
    }
  }

  /**
   * Возвращает строковое представление узла для отладки
   */
  toString(): string {
    return `DINode(${this.id})`;
  }
}
