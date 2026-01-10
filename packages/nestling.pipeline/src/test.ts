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

import type { Logger } from './middlewares/logging';
import { withLogging } from './middlewares/logging';
import { withTiming } from './middlewares/timing';
import type { InferPipelineMeta } from './core';
import { definePipeline } from './core';
import { validate, withIdentity } from './middlewares';

interface User {
  id: string;
  name: string;
  email: string;
}

// ============================================================================
// Пример 1: Базовый pipeline с аутентификацией
// ============================================================================

const pipeline = definePipeline()
  .use(validate()) // Валидация входных данных
  .use(withTiming) // Измерение времени выполнения
  .use(withLogging(console)) // Логирование запросов
  .use(
    withIdentity<User>(async () => {
      // Аутентификация пользователя
      return {
        id: '1',
        name: 'John Doe',
        email: 'john.doe@example.com',
      };
    }),
  );

// Проверка типа meta
type PipelineMeta = InferPipelineMeta<typeof pipeline>;
// ✅ PipelineMeta = { identity: User }

// Эта проверка должна скомпилироваться
type _AssertIdentity = PipelineMeta extends { identity: User } ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _check: _AssertIdentity = true;

// ============================================================================
// Пример 2: Неправильная последовательность (должна вызывать ошибку типа)
// ============================================================================

// ❌ НЕПРАВИЛЬНО: withLogging после validate() не имеет доступа к raw
// Раскомментируйте, чтобы увидеть ошибку TypeScript:
// const wrongPipeline = definePipeline()
//   .use(validate())
//   .use(withLogging(console as Logger)); // ❌ Ошибка типа!

// ============================================================================
// Пример 3: Переиспользование базового pipeline
// ============================================================================

const basePipeline = definePipeline()
  .use(withTiming)
  .use(withLogging(console as Logger));

// Можно создавать разные варианты из базового
const userPipeline = basePipeline
  .use(
    withIdentity<User>(async () => ({
      id: '1',
      name: 'User',
      email: 'user@example.com',
    })),
  )
  .use(validate());

type UserMeta = InferPipelineMeta<typeof userPipeline>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertUserIdentity = UserMeta extends { identity: User } ? true : never;

// ============================================================================
// Экспорт для использования в других модулях
// ============================================================================

export { pipeline, basePipeline, userPipeline };
export type { PipelineMeta, UserMeta };
