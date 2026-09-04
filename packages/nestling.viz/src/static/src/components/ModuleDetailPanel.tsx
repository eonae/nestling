import { useState, useEffect } from 'react';
import { GraphNode } from '../types/index.js';
import { EVENTS } from '../core/event-bus.js';
import { IEventBus } from '../types/index.js';
import {
  safeGetEventData,
  isModuleFocusedEventData,
} from '../utils/typeGuards.js';

interface ModuleDetailPanelProps {
  eventBus: IEventBus;
}

export function ModuleDetailPanel({ eventBus }: ModuleDetailPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [moduleData, setModuleData] = useState<{
    name: string;
    nodes: GraphNode[];
    color: string;
  } | null>(null);

  useEffect(() => {
    const handleModuleFocused = (data?: unknown) => {
      const moduleData = safeGetEventData(data, isModuleFocusedEventData);
      if (!moduleData) return;

      setIsLoading(true);
      setIsVisible(true);

      // Сразу устанавливаем данные модуля
      setModuleData({
        name: moduleData.moduleName,
        nodes: moduleData.moduleNodes,
        color: moduleData.moduleNodes[0]?.color || '#6b7280',
      });
    };

    const handleFocusLoadingEnd = () => {
      setIsLoading(false);
    };

    const handleFocusReset = () => {
      setIsVisible(false);
      setIsLoading(false);
      setModuleData(null);
    };

    eventBus.on(EVENTS.MODULE_FOCUSED, handleModuleFocused);
    eventBus.on(EVENTS.FOCUS_LOADING_END, handleFocusLoadingEnd);
    eventBus.on(EVENTS.FOCUS_RESET, handleFocusReset);

    return () => {
      eventBus.off(EVENTS.MODULE_FOCUSED, handleModuleFocused);
      eventBus.off(EVENTS.FOCUS_LOADING_END, handleFocusLoadingEnd);
      eventBus.off(EVENTS.FOCUS_RESET, handleFocusReset);
    };
  }, [eventBus]);

  const handleClose = () => {
    eventBus.emit(EVENTS.FOCUS_RESET);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="module-detail-panel">
      <ModuleDetailHeader onClose={handleClose} />

      <div className="module-detail-content">
        {isLoading ? (
          <LoadingContent moduleName={moduleData?.name || 'module'} />
        ) : moduleData ? (
          <ModuleContent moduleData={moduleData} />
        ) : null}
      </div>
    </div>
  );
}

interface ModuleDetailHeaderProps {
  onClose: () => void;
}

function ModuleDetailHeader({ onClose }: ModuleDetailHeaderProps) {
  return (
    <div className="module-detail-main-header">
      <h3>MODULE DETAILS</h3>
      <button
        className="module-detail-close-button"
        onClick={onClose}
        title="Close and reset selection"
      >
        ✕
      </button>
    </div>
  );
}

interface LoadingContentProps {
  moduleName: string;
}

function LoadingContent({ moduleName }: LoadingContentProps) {
  return (
    <div className="loading-content">
      <div className="module-detail-loader">
        <div className="module-detail-spinner" />
        <div className="loader-text">
          <h4>Loading {moduleName}...</h4>
          <p>Focusing camera and preparing details</p>
        </div>
      </div>
    </div>
  );
}

interface ModuleContentProps {
  moduleData: {
    name: string;
    nodes: GraphNode[];
    color: string;
  };
}

function ModuleContent({ moduleData }: ModuleContentProps) {
  return (
    <>
      <div className="module-detail-header">
        <div className="module-detail-title">
          <div
            className="module-color-indicator"
            style={{ backgroundColor: moduleData.color }}
          />
          <h4>{moduleData.name}</h4>
        </div>
      </div>

      <div className="module-stats">
        <div className="stat-item">
          <span className="stat-label">Nodes:</span>
          <span className="stat-value">{moduleData.nodes.length}</span>
        </div>
      </div>

      <div className="nodes-list">
        <h5>Module Components:</h5>
        <div className="node-items">
          {moduleData.nodes
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((node) => (
              <NodeItem key={node.id} node={node} />
            ))}
        </div>
      </div>
    </>
  );
}

interface NodeItemProps {
  node: GraphNode;
}

function NodeItem({ node }: NodeItemProps) {
  return (
    <div
      className="node-item-container"
      title={`${node.name}\nDependencies: ${node.dependencyCount || 0}`}
    >
      <span className="node-item-name">{node.name}</span>
    </div>
  );
}
