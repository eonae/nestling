/**
 * Общие типы для всего приложения
 */

/**
 * Интерфейс пользователя
 */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Результат импорта пользователей
 */
export interface ImportResult {
  imported: number;
  failed: number;
  errors?: Array<{
    line: number;
    error: string;
  }>;
}

