import { useEffect } from 'react';
import { useGraphData } from './hooks/useGraphData';
import { eventBus } from './core/event-bus';
import { GraphRenderer } from './components/GraphRenderer';
import { ModulesBrowser } from './components/ModulesBrowser';
import { ModuleDetailPanel } from './components/ModuleDetailPanel';
import { LoadingScreen } from './components/LoadingScreen';

export function App() {
  const { graphData, isLoading, error, loadGraphData } = useGraphData();

  useEffect(() => {
    loadGraphData('/data/graph-data.json').catch(console.error);
  }, [loadGraphData]);

  if (error) {
    return (
      <div className="error-screen">
        <h1>Error loading graph data</h1>
        <p>{error}</p>
        <button onClick={() => loadGraphData('/data/graph-data.json')}>
          Retry
        </button>
      </div>
    );
  }

  if (isLoading || !graphData) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-container">
      <div className="left-column">
        <GraphRenderer graphData={graphData} eventBus={eventBus} />
      </div>
      <div className="right-column">
        <ModulesBrowser modules={graphData.modules} eventBus={eventBus} />
        <ModuleDetailPanel eventBus={eventBus} />
      </div>
    </div>
  );
}