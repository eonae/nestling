/**
 * Нормализованные данные входа транспорта.
 *
 * Транспорт создаёт `Raw` из сырого запроса:
 * - HTTP: `payload` собран по bind-карте декларации (каждое поле — из
 *   своего канонического места), `attributes` — заголовки.
 * - gRPC: `payload` — decoded message, `attributes` — metadata.
 * - CLI: `payload` — parsed args, `attributes` — `{ env, flags }`.
 */
export interface Raw {
  /** Имя транспорта */
  transport: string; // 'http' | 'grpc' | 'cli' | ...

  /** Паттерн маршрута */
  pattern: string;

  /**
   * Нормализованные входные данные.
   * Форма зависит от input-конфигурации endpoint'а: объект (схема),
   * Buffer/string (примитив), AsyncIterable (поток), файлы и другое.
   */
  payload: unknown;

  /** Транспортные атрибуты: заголовки (HTTP), metadata (gRPC), флаги (CLI) */
  attributes: Record<string, unknown>;
}
