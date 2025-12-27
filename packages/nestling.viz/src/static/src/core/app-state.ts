import type { Graph3D, ForceGraphNode, ForceGraphData } from '../types/graph3d';
import type { GraphNode } from '../types';
import { eventBus, EVENTS } from './event-bus';

class FocusState {
  private state = {
    focusedModule: null as string | null,
    focusedNode: null as GraphNode | null,
    focusedNodes: [] as GraphNode[],
    isPanoramaMode: true,
    isFocusLoading: false,
  };

  getState() {
    return { ...this.state };
  }

  setModule(moduleName: string, node: GraphNode, nodes: GraphNode[]) {
    this.state.focusedModule = moduleName;
    this.state.focusedNode = node;
    this.state.focusedNodes = nodes;
    this.state.isPanoramaMode = false;
  }

  setLoading(isLoading: boolean) {
    this.state.isFocusLoading = isLoading;
    eventBus.emit(
      isLoading ? EVENTS.FOCUS_LOADING_START : EVENTS.FOCUS_LOADING_END,
    );
  }

  reset() {
    this.state.focusedModule = null;
    this.state.focusedNode = null;
    this.state.focusedNodes = [];
    this.state.isPanoramaMode = true;
    this.state.isFocusLoading = false;
  }

  clear() {
    this.reset();
  }
}

class HighlightState {
  private highlighted = new Set<string | number>();
  private hoveredNode: ForceGraphNode | null = null;

  clear() {
    this.highlighted.clear();
    this.hoveredNode = null;
  }

  add(nodes: GraphNode[]) {
    nodes.forEach((node) => this.highlighted.add(String(node.id)));
  }

  has(nodeId: string): boolean {
    return this.highlighted.has(nodeId);
  }

  hasAny(): boolean {
    return this.highlighted.size > 0;
  }

  setHovered(node: ForceGraphNode | null) {
    this.hoveredNode = node;
  }

  getHovered(): ForceGraphNode | null {
    return this.hoveredNode;
  }
}

class GraphState {
  private graph: Graph3D | null = null;
  private data: ForceGraphData | null = null;
  private stabilized = false;
  private optimalCameraDistance = 500;
  private lastClickedNode: GraphNode | null = null;
  private clickTimeoutId: NodeJS.Timeout | null = null;

  getGraph(): Graph3D | null {
    return this.graph;
  }

  setGraph(graph: Graph3D, data: ForceGraphData) {
    this.graph = graph;
    this.data = data;
  }

  getData(): ForceGraphData | null {
    return this.data;
  }

  isStabilized(): boolean {
    return this.stabilized;
  }

  setStabilized(value: boolean) {
    this.stabilized = value;
  }

  getOptimalCameraDistance(): number {
    return this.optimalCameraDistance;
  }

  setOptimalCameraDistance(distance: number) {
    this.optimalCameraDistance = distance;
  }

  getLastClickedNode(): GraphNode | null {
    return this.lastClickedNode;
  }

  setLastClickedNode(node: GraphNode | null) {
    this.lastClickedNode = node;
  }

  getClickTimeout(): NodeJS.Timeout | null {
    return this.clickTimeoutId;
  }

  setClickTimeout(timeout: NodeJS.Timeout | null) {
    if (this.clickTimeoutId) {
      clearTimeout(this.clickTimeoutId);
    }
    this.clickTimeoutId = timeout;
  }

  clear() {
    this.graph = null;
    this.data = null;
    this.stabilized = false;
    this.optimalCameraDistance = 500;
    this.lastClickedNode = null;
    if (this.clickTimeoutId) {
      clearTimeout(this.clickTimeoutId);
      this.clickTimeoutId = null;
    }
  }
}

export const focusState = new FocusState();
export const highlightState = new HighlightState();
export const graphState = new GraphState();
