/**
 * Общие типы примера.
 */

/**
 * Пользователь.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * Результат импорта пользователей.
 */
export interface ImportResult {
  imported: number;
  failed: number;
  errors?: {
    line: number;
    error: string;
  }[];
}
