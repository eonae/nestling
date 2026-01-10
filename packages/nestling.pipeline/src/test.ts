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
import { validate } from './middlewares';

// ============================================================================
// Пример 1: Базовый pipeline с аутентификацией
// ============================================================================

const pipeline = definePipeline()
  .use(validate()) // Валидация входных данных
  .use(validate()); // Валидация входных данных

// .use(withTiming) // Измерение времени выполнения
// .use(withRequestLogging(console)) // Логирование запросов
// .use(
//   withIdentity<User>(async () => {
//     // Аутентификация пользователя
//     return {
//       id: '1',
//       name: 'John Doe',
//       email: 'john.doe@example.com',
//     };
//   }),
// );
