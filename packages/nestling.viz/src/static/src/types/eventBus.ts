import { GraphNode } from './graphTypes';

// Интерфейс для EventBus
export interface IEventBus {
  on(event: string, callback: (data?: unknown) => void): void;
  emit(event: string, data?: unknown): void;
  off(event: string, callback: (data?: unknown) => void): void;
  clear(event?: string): void;
}

// Типы данных для различных событий
export interface ModuleFocusedEventData {
  moduleName: string;
  moduleNode: GraphNode;
  moduleNodes: GraphNode[];
}

export interface ZoomUpdateEventData {
  level: number;
  distance: number;
}

// Карта типов событий
export interface EventDataMap {
  'module:focused': ModuleFocusedEventData;
  'focus:reset': undefined;
  'focus:loading:start': undefined;
  'focus:loading:end': undefined;
  'highlight:cleared': undefined;
  'graph:ready': undefined;
  'graph:stabilized': undefined;
  'module:selected': { moduleName: string };
  'panel:shown': undefined;
  'panel:hidden': undefined;
  'zoom:updated': ZoomUpdateEventData;
}
