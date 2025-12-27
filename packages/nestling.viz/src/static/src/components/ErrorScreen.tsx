interface ErrorScreenProps {
  title: string;
  message: string;
  hint?: string;
  onRetry?: () => void;
}

export function ErrorScreen({
  title,
  message,
  hint,
  onRetry,
}: ErrorScreenProps) {
  return (
    <div className="error-screen-container">
      <h2 className="error-screen-title">❌ {title}</h2>

      <p className="error-screen-message">{message}</p>

      {hint && <p className="error-screen-hint">{hint}</p>}

      {onRetry && (
        <button onClick={onRetry} className="error-screen-retry-btn">
          Повторить попытку
        </button>
      )}
    </div>
  );
}
