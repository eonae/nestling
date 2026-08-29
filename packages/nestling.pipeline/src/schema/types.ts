/**
 * Объединённые источники входных данных.
 */
export interface InputSources {
  /**
   * Данные пользователя: тело запроса, query и params вместе.
   * Совпадение имён между источниками — ошибка.
   */
  payload: Record<string, unknown>;

  /**
   * Данные транспорта: заголовки, аутентификация, трассировка и другое.
   */
  metadata: Record<string, unknown>;
}
