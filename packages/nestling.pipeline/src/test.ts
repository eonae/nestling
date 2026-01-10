/**
 * Пример использования типизированного Pipeline
 *
 * Этот файл демонстрирует:
 * 1. Правильную последовательность middleware
 * 2. Накопление meta через цепочку
 * 3. Типовую безопасность на каждом шаге
 *
 * Для проверки типов запустите: npx tsc --noEmit
 * Для полных типовых тестов см. ./core/pipeline.types.spec.ts
 */

import { definePipeline } from './core';
import { validate, withIdentity, withPermissions } from './middlewares';

// ============================================================================
// Пример 1: Базовый pipeline с аутентификацией
// ============================================================================

interface User {
  userId: number;
}

interface Permissions {
  permissions: string[];
}

const pipeline = definePipeline()
  .use(validate()) // Валидация входных данных
  .use(withIdentity<User>(async () => ({ userId: 1 })))
  .use(
    withPermissions<Permissions, User>(async () => ({
      permissions: ['r', 'w'],
    })),
  );
