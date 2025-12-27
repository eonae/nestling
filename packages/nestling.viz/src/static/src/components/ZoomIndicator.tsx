interface ZoomInfo {
  level: number;
  distance: number;
  visible: boolean;
}

interface ZoomIndicatorProps {
  zoomInfo: ZoomInfo;
}

export function ZoomIndicator({ zoomInfo }: ZoomIndicatorProps) {
  return (
    <div className="zoom-indicator">
      <span className="zoom-label">Zoom: </span>
      <span className="zoom-value">{zoomInfo.level.toFixed(1)}x</span>
      <span className="zoom-distance">({Math.round(zoomInfo.distance)})</span>
    </div>
  );
}

export type { ZoomInfo };
