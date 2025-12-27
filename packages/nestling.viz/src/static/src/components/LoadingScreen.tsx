export function LoadingScreen() {
  return (
    <div className="loading">
      <div className="loading-content">
        <h2>Loading Dependency Graph</h2>
        <div className="spinner"></div>
        <p>Analyzing project structure...</p>
      </div>
    </div>
  );
}
