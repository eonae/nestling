/**
 * Данные от транспорта
 * Содержит нормализованные данные входа транспорта
 *
 * Transport создаёт Raw из сырого запроса:
 * - HTTP: payload собран по bind-карте декларации (каждое поле — из своего
 *   канонического места), attributes = headers
 * - gRPC: payload = decoded message, attributes = metadata
 * - CLI: payload = parsed args, attributes = { env, flags }
 */
export interface Raw {
  /** Имя транспорта */
  transport: string; // 'http' | 'grpc' | 'cli' | ...

  /** Паттерн маршрута */
  pattern: string;

  /**
   * Нормализованные входные данные.
   * Форма зависит от input-конфигурации endpoint'а: объект (schema),
   * Buffer/string (primitive), AsyncIterable (stream), файлы и т.д.
   */
  payload: unknown;

  /** Транспортные атрибуты (headers | grpc metadata | cli flags) */
  attributes: Record<string, unknown>;
}
