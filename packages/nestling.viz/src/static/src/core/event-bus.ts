import { IEventBus } from '../types';

// Единый EventBus для всего приложения
class EventBus implements IEventBus {
  private listeners = new Map<string, Array<(data?: unknown) => void>>();

  on(event: string, callback: (data?: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, data?: unknown): void {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Ошибка в обработчике события ${event}:`, error);
      }
    });
  }

  off(event: string, callback: (data?: unknown) => void): void {
    const callbacks = this.listeners.get(event) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Создаем единый экземпляр EventBus
export const eventBus = new EventBus();

// Экспортируем события
export const EVENTS = {
  MODULE_FOCUSED: 'module:focused',
  FOCUS_RESET: 'focus:reset',
  FOCUS_LOADING_START: 'focus:loading:start',
  FOCUS_LOADING_END: 'focus:loading:end',
  NODES_HIGHLIGHTED: 'nodes:highlighted',
  HIGHLIGHT_CLEARED: 'highlight:cleared',
  GRAPH_READY: 'graph:ready',
  GRAPH_STABILIZED: 'graph:stabilized',
  MODULE_SELECTED: 'module:selected',
  PANEL_SHOWN: 'panel:shown',
  PANEL_HIDDEN: 'panel:hidden',
} as const;
