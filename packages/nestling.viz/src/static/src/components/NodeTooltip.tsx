import React from 'react';
import { GraphNode } from '../types';

interface NodeTooltipProps {
  node: GraphNode;
  position: { x: number; y: number };
  visible: boolean;
}

export function NodeTooltip({ node, position, visible }: NodeTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="node-tooltip"
      style={{ left: position.x + 10, top: position.y - 10 }}
    >
      <div className="node-tooltip-title">{node.name}</div>

      <div className="node-tooltip-row">
        <span className="node-tooltip-label">Module:</span>{' '}
        <span>{node.module || 'none'}</span>
      </div>

      <div className="node-tooltip-row">
        <span className="node-tooltip-label">Exported:</span>{' '}
        <span
          className={`node-tooltip-exported-${node.exported ? 'yes' : 'no'}`}
        >
          {node.exported ? 'yes' : 'no'}
        </span>
      </div>

      <div className="node-tooltip-row">
        <span className="node-tooltip-label">Dependencies:</span>{' '}
        <span>{node.dependencyCount || 0}</span>
      </div>
    </div>
  );
}

interface NodeTooltipData {
  node: GraphNode;
  position: { x: number; y: number };
}

interface UseNodeTooltipReturn {
  tooltipData: NodeTooltipData | null;
  showTooltip: (node: GraphNode, x: number, y: number) => void;
  hideTooltip: () => void;
}

export function useNodeTooltip(): UseNodeTooltipReturn {
  const [tooltipData, setTooltipData] = React.useState<NodeTooltipData | null>(
    null,
  );

  const showTooltip = React.useCallback(
    (node: GraphNode, x: number, y: number) => {
      setTooltipData({ node, position: { x, y } });
    },
    [],
  );

  const hideTooltip = React.useCallback(() => {
    setTooltipData(null);
  }, []);

  return { tooltipData, showTooltip, hideTooltip };
}
