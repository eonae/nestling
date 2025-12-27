export interface INode<T extends INode<T> = never> {
  id: string;
  dependencies: readonly T[];
}
