import { useEffect, useRef, useState } from 'react';
import { GraphData } from '../types';
import { render, cleanupGraph } from '../renderer/graph-renderer';
import { ErrorScreen } from './ErrorScreen';
import { ZoomIndicator, type ZoomInfo } from './ZoomIndicator';
import { IEventBus } from '../types';
import { safeGetEventData, isZoomUpdateEventData } from '../utils/typeGuards';

interface GraphRendererProps {
  graphData: GraphData;
  eventBus: IEventBus;
}

export function GraphRenderer({ graphData, eventBus }: GraphRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomInfo, setZoomInfo] = useState<ZoomInfo>({
    level: 1.0,
    distance: 800,
    visible: true,
  });

  useEffect(() => {
    if (!containerRef.current || !graphData) return;

    let cleanupFn: (() => void) | undefined;
    let isCancelled = false;

    const initializeGraph = async () => {
      try {
        // Предотвращаем повторную инициализацию если компонент размонтирован
        if (isCancelled) return;

        setError(null);

        // Очищаем предыдущий граф если он есть
        cleanupGraph();

        // Создаем временный JSON файл с данными для рендерера
        const graphDataBlob = new Blob(
          [
            JSON.stringify({
              nodes: graphData.nodes.map((node) => ({
                id: node.id,
                dependencies: graphData.links
                  .filter((link) => link.source === node.id)
                  .map((link) => link.target),
                metadata: {
                  module: node.module,
                  exported: node.exported,
                },
              })),
            }),
          ],
          { type: 'application/json' },
        );

        const tempUrl = URL.createObjectURL(graphDataBlob);

        // Проверяем ещё раз перед рендерингом
        if (isCancelled) {
          URL.revokeObjectURL(tempUrl);
          return;
        }

        // Инициализируем 3D граф
        await render(tempUrl);

        // Граф готов

        // Очищаем временный URL
        URL.revokeObjectURL(tempUrl);

        // Настраиваем слушатели для зума
        const handleZoomUpdate = (data?: unknown) => {
          if (isCancelled) return;

          const zoomData = safeGetEventData(data, isZoomUpdateEventData);
          if (!zoomData) return;

          setZoomInfo({
            level: zoomData.level,
            distance: zoomData.distance,
            visible: true,
          });
        };

        if (!isCancelled) {
          eventBus.on('zoom:updated', handleZoomUpdate);
          cleanupFn = () => eventBus.off('zoom:updated', handleZoomUpdate);
        }
      } catch (error) {
        if (!isCancelled) {
          console.error('Ошибка инициализации 3D графа:', error);
          setError(
            error instanceof Error ? error.message : 'Неизвестная ошибка',
          );
        }
      }
    };

    initializeGraph();

    return () => {
      isCancelled = true;
      cleanupFn?.();
      cleanupGraph();
    };
  }, [graphData, eventBus]);

  const handleRetry = () => {
    setError(null);
    // Перезапускаем эффект
    const event = new CustomEvent('retry-graph-init');
    window.dispatchEvent(event);
  };

  if (error) {
    return (
      <div className="graph-container">
        <ErrorScreen
          title="Ошибка загрузки 3D графа"
          message={error}
          hint="Проверьте консоль браузера для получения дополнительной информации"
          onRetry={handleRetry}
        />
      </div>
    );
  }

  return (
    <div className="graph-container">
      {/* 3D контейнер - React не должен сюда лезть */}
      <div
        ref={containerRef}
        id="graph-container"
        className="graph-container-inner"
        suppressHydrationWarning
      />

      {/* Индикатор зума */}
      <ZoomIndicator zoomInfo={zoomInfo} />
    </div>
  );
}
