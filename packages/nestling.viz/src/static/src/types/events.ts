import type { GraphNode } from './graphTypes';

export const EVENTS = {
  MODULE_FOCUSED: 'module:focused',
  FOCUS_RESET: 'focus:reset',
  FOCUS_LOADING_START: 'focus:loading:start',
  FOCUS_LOADING_END: 'focus:loading:end',
  NODES_HIGHLIGHTED: 'nodes:highlighted',
  HIGHLIGHT_CLEARED: 'highlight:cleared',
  GRAPH_STABILIZED: 'graph:stabilized',
} as const;

export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

export interface ModuleFocusedEvent {
  moduleName: string;
  moduleNode: GraphNode;
  moduleNodes: GraphNode[];
}

export interface NodesHighlightedEvent {
  nodes: GraphNode[];
}

export type EventData = {
  [EVENTS.MODULE_FOCUSED]: ModuleFocusedEvent;
  [EVENTS.NODES_HIGHLIGHTED]: NodesHighlightedEvent;
  [EVENTS.FOCUS_RESET]: undefined;
  [EVENTS.FOCUS_LOADING_START]: undefined;
  [EVENTS.FOCUS_LOADING_END]: undefined;
  [EVENTS.HIGHLIGHT_CLEARED]: undefined;
  [EVENTS.GRAPH_STABILIZED]: undefined;
};

export type EventCallback<T extends EventType> = (data: EventData[T]) => void;
