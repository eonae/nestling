import type { Graph3D, ForceGraphNode } from '../types/graph3d';
import type { NodeObject } from '3d-force-graph';
import { Vector3 } from 'three';
import { eventBus } from './event-bus';

export function initializeZoomTracking(
  graph: Graph3D,
  optimalDistance: number,
): void {
  let lastZoom = optimalDistance;
  let debounceTimer: number | null = null;

  // Проверяем есть ли метод onZoom в типах
  if ('onZoom' in graph && typeof graph.onZoom === 'function') {
    graph.onZoom((zoom: { k: number }) => {
      const currentZoom = zoom.k;
      const zoomDelta = Math.abs(currentZoom - lastZoom);

      if (zoomDelta > 0.1) {
        // Масштабируем размеры узлов и стрелок в зависимости от зума
        const nodeScale = 1 / Math.sqrt(currentZoom);
        const arrowScale = 1 / Math.pow(currentZoom, 0.3);

        graph
          .nodeVal((node: NodeObject) => {
            const graphNode = node as ForceGraphNode;
            return (graphNode.size || 4) * nodeScale;
          })
          .linkDirectionalArrowLength(4 * arrowScale);

        // Отправляем событие о зуме для React компонентов с debounce
        if (debounceTimer) {
          window.clearTimeout(debounceTimer);
        }

        debounceTimer = window.setTimeout(() => {
          eventBus.emit('zoom:updated', {
            level: currentZoom,
            distance: optimalDistance / currentZoom,
          });
        }, 100);

        lastZoom = currentZoom;
      }
    });
  } else {
    // Попробуем через камеру
    if ('camera' in graph && graph.camera) {
      const controls = graph.controls();
      if (controls && 'addEventListener' in controls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (controls as any).addEventListener('change', () => {
          const camera = graph.camera();
          if (camera) {
            const distance = camera.position.distanceTo(new Vector3(0, 0, 0));
            const zoomLevel = optimalDistance / distance;

            // Отправляем событие о зуме для React компонентов с debounce
            if (debounceTimer) {
              window.clearTimeout(debounceTimer);
            }

            debounceTimer = window.setTimeout(() => {
              eventBus.emit('zoom:updated', {
                level: zoomLevel,
                distance: distance,
              });
            }, 100);
          }
        });
      }
    }
  }
}
