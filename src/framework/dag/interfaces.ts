export interface INode<T extends INode<T> = any> {
  id: string;
  dependencies: readonly T[];
}
