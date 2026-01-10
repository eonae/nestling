/**
 * Данные от транспорта
 * Содержит нормализованные данные входа транспорта
 *
 * Transport создаёт Raw из сырого запроса:
 * - HTTP: payload = merge(body, params, query), attributes = headers
 * - gRPC: payload = decoded message, attributes = metadata
 * - CLI: payload = parsed args, attributes = { env, flags }
 */
export interface Raw {
  /** Имя транспорта */
  transport: string; // 'http' | 'grpc' | 'cli' | ...

  /** Паттерн маршрута */
  pattern: string;

  /** Нормализованные входные данные */
  payload: Record<string, unknown>;

  /** Транспортные атрибуты (headers | grpc metadata | cli flags) */
  attributes: Record<string, unknown>;
}
