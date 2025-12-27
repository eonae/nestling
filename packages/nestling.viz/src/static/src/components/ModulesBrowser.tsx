import { useState, useEffect } from 'react';
import { Module } from '../types';
import { EVENTS } from '../core/event-bus';
import { IEventBus } from '../types';
import {
  safeGetEventData,
  isModuleFocusedEventData,
} from '../utils/typeGuards';

interface ModulesBrowserProps {
  modules: Module[];
  eventBus: IEventBus;
}

export function ModulesBrowser({ modules, eventBus }: ModulesBrowserProps) {
  const [focusedModule, setFocusedModule] = useState<string | null>(null);

  useEffect(() => {
    const handleModuleFocused = (data?: unknown) => {
      const moduleData = safeGetEventData(data, isModuleFocusedEventData);
      if (moduleData) {
        setFocusedModule(moduleData.moduleName);
      }
    };

    const handleFocusReset = () => {
      setFocusedModule(null);
    };

    eventBus.on(EVENTS.MODULE_FOCUSED, handleModuleFocused);
    eventBus.on(EVENTS.FOCUS_RESET, handleFocusReset);

    return () => {
      eventBus.off(EVENTS.MODULE_FOCUSED, handleModuleFocused);
      eventBus.off(EVENTS.FOCUS_RESET, handleFocusReset);
    };
  }, [eventBus]);

  const handleModuleClick = (module: Module) => {
    const firstComponent = module.components[0];
    if (firstComponent) {
      eventBus.emit(EVENTS.MODULE_FOCUSED, {
        moduleName: module.name,
        moduleNode: firstComponent,
        moduleNodes: module.components,
      });
    }
  };

  return (
    <div className="modules-browser">
      <h3>MODULES</h3>
      <div className="modules-browser-content">
        <div className="module-groups">
          {modules.map((module) => (
            <ModuleCard
              key={module.name}
              module={module}
              isFocused={focusedModule === module.name}
              onClick={() => handleModuleClick(module)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ModuleCardProps {
  module: Module;
  isFocused: boolean;
  onClick: () => void;
}

function ModuleCard({ module, isFocused, onClick }: ModuleCardProps) {
  const exportedCount = module.components.filter((c) => c.exported).length;

  return (
    <div
      className={`module-group clickable-module ${isFocused ? 'focused-module' : ''}`}
      onClick={onClick}
    >
      <div className="module-header">
        <div className="module-card-header">
          <div
            className="module-color"
            style={{ backgroundColor: module.color }}
          />
          <div className="module-name">{module.name}</div>
        </div>
        <div className="module-stats-row">
          <div className="module-stats-tags">
            <span className="module-count">
              {module.components.length} nodes
            </span>
            <span className="module-exports">{exportedCount} exported</span>
          </div>
        </div>
      </div>
    </div>
  );
}
