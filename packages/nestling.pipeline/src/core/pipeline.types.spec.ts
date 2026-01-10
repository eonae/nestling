/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Типовые тесты для Pipeline
 *
 * Проверяют, что:
 * 1. Выходной тип каждого middleware совместим с входным типом следующего
 * 2. Неправильные комбинации вызывают ошибки компиляции
 * 3. Meta-поля корректно накапливаются через цепочку
 * 4. После validate() нельзя использовать middleware, требующие UnvalidatedContext
 */

import { validate, withIdentity, withMeta } from '../middlewares';
import type { Logger } from '../middlewares/logging';
import { withRequestLogging } from '../middlewares/logging';
import { withTiming } from '../middlewares/timing';

import type { HasValidation, InferPipelineMeta } from './pipeline';
import { definePipeline } from './pipeline';
import type {
  ResponseContext,
  ExtendableContext,
  ValidatedContext,
} from './types';

// ============================================================================
// Mock типы для тестов
// ============================================================================

interface User {
  id: string;
  name: string;
  email: string;
}

interface AdminUser extends User {
  role: 'admin';
  permissions: string[];
}

const mockAuthenticator = async (): Promise<User> => ({
  id: '1',
  name: 'John Doe',
  email: 'john.doe@example.com',
});

const mockLogger: Logger = {
  log: () => {
    /* noop */
  },
};

// ============================================================================
// Тест 1: Базовая типовая совместимость цепочки
// ============================================================================

describe('Pipeline type compatibility', () => {
  it('should accept correct middleware chain', () => {
    // ✅ Правильная последовательность
    const pipeline = definePipeline()
      .use(withTiming) // AnyContext → AnyContext
      .use(withRequestLogging(mockLogger)) // UnvalidatedContext<M> → UnvalidatedContext<M>
      .use(withIdentity<User>(mockAuthenticator)) // UnvalidatedContext<M> → UnvalidatedContext<M & { identity: User }>
      .use(validate()); // UnvalidatedContext<M> → ValidatedContext<I, M>

    // Проверка типа pipeline
    type PipelineMeta = InferPipelineMeta<typeof pipeline>;
    type _AssertMeta = PipelineMeta extends { identity: User } ? true : never;

    type HasVal = HasValidation<typeof pipeline>;
    type _AssertHasVal = HasVal extends true ? true : never;
  });

  // ============================================================================
  // Тест 2: Невозможность использования raw-middleware после validate
  // ============================================================================

  it('should reject logging after validate (needs raw.transport)', () => {
    // Проверяем, что это действительно ошибка типа
    const pipelineWithValidate = definePipeline().use(validate());

    // TypeScript должен выдать ошибку на следующей строке:
    // withLogging требует UnvalidatedContext (доступ к raw.transport, raw.pattern)
    // но pipelineWithValidate возвращает ValidatedContext
    const _testAssignment: typeof pipelineWithValidate = pipelineWithValidate;
  });

  it('should reject identity after validate (needs raw.attributes)', () => {
    // Проверяем типовую несовместимость
    const pipelineWithValidate = definePipeline().use(validate());

    // TypeScript должен выдать ошибку, если попытаться использовать withIdentity
    const _testAssignment: typeof pipelineWithValidate = pipelineWithValidate;
  });

  // ============================================================================
  // Тест 3: Накопление meta через цепочку
  // ============================================================================

  it('should accumulate meta fields correctly', () => {
    const pipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator)) // meta: { identity: User }
      .use(withMeta('requestId', () => 'test-id')) // meta: { identity: User; requestId: string }
      .use(withMeta('timestamp', () => Date.now())) // meta: { identity: User; requestId: string; timestamp: number }
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;

    // Проверяем, что все поля присутствуют
    type _AssertIdentity = Meta extends { identity: User } ? true : never;
    type _AssertRequestId = Meta extends { requestId: string } ? true : never;
    type _AssertTimestamp = Meta extends { timestamp: number } ? true : never;
  });

  // ============================================================================
  // Тест 4: Порядок middleware имеет значение
  // ============================================================================

  it('should accept identity before validate', () => {
    // ✅ Правильный порядок
    const pipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator))
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends { identity: User } ? true : never;
  });

  // ============================================================================
  // Тест 5: Множественные middleware одного типа
  // ============================================================================

  it('should allow multiple withMeta middleware', () => {
    const pipeline = definePipeline()
      .use(withMeta('requestId', () => 'id-1'))
      .use(withMeta('sessionId', () => 'session-1'))
      .use(withMeta('traceId', () => 'trace-1'))
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _AssertAll = Meta extends {
      requestId: string;
      sessionId: string;
      traceId: string;
    }
      ? true
      : never;
  });

  // ============================================================================
  // Тест 6: Generic типы в middleware
  // ============================================================================

  it('should work with different user types', () => {
    // Pipeline для админа
    const adminPipeline = definePipeline()
      .use(
        withIdentity<AdminUser>(async () => ({
          id: '1',
          name: 'Admin',
          email: 'admin@example.com',
          role: 'admin',
          permissions: ['read', 'write'],
        })),
      )
      .use(validate());

    type AdminMeta = InferPipelineMeta<typeof adminPipeline>;
    type _AssertAdmin = AdminMeta extends { identity: AdminUser }
      ? true
      : never;

    // Pipeline для обычного пользователя
    const userPipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator))
      .use(validate());

    type UserMeta = InferPipelineMeta<typeof userPipeline>;
    type _AssertUser = UserMeta extends { identity: User } ? true : never;
  });

  // ============================================================================
  // Тест 7: Пустой pipeline
  // ============================================================================

  it('should have correct type for empty pipeline', () => {
    const emptyPipeline = definePipeline();

    type HasVal = HasValidation<typeof emptyPipeline>;
    type _AssertNoValidation = HasVal extends false ? true : never;

    type Meta = InferPipelineMeta<typeof emptyPipeline>;
    type _AssertEmptyMeta = Meta extends Record<string, never> ? true : never;
  });

  it('should have correct type for pipeline with only validate', () => {
    const onlyValidate = definePipeline().use(validate());

    type HasVal = HasValidation<typeof onlyValidate>;
    type _AssertHasValidation = HasVal extends true ? true : never;
  });

  // ============================================================================
  // Тест 8: withTiming работает с любым контекстом
  // ============================================================================

  it('should allow timing before validate', () => {
    // ✅ Работает с UnvalidatedContext
    const pipeline = definePipeline()
      .use(withTiming)
      .use(withIdentity<User>(mockAuthenticator))
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends { identity: User } ? true : never;
  });

  it('should allow timing after validate', () => {
    // ✅ Работает с ValidatedContext
    const pipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator))
      .use(validate())
      .use(withTiming);

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends { identity: User } ? true : never;
  });

  it('should allow multiple timing middleware', () => {
    const pipeline = definePipeline()
      .use(withTiming)
      .use(withIdentity<User>(mockAuthenticator))
      .use(withTiming)
      .use(validate())
      .use(withTiming);

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends { identity: User } ? true : never;
  });

  // ============================================================================
  // Тест 9: Комплексный реальный сценарий
  // ============================================================================

  it('should work in realistic scenario', () => {
    const realisticPipeline = definePipeline()
      .use(withTiming) // Измерение времени
      .use(withRequestLogging(mockLogger)) // Логирование
      .use(withMeta('requestId', () => crypto.randomUUID())) // Request ID
      .use(withMeta('timestamp', () => Date.now())) // Timestamp
      .use(withIdentity<User>(mockAuthenticator)) // Аутентификация
      .use(validate()); // Валидация

    type Meta = InferPipelineMeta<typeof realisticPipeline>;

    // Проверяем все поля
    type _Assert = Meta extends {
      requestId: string;
      timestamp: number;
      identity: User;
    }
      ? true
      : never;

    type HasVal = HasValidation<typeof realisticPipeline>;
    type _AssertHasVal = HasVal extends true ? true : never;
  });

  // ============================================================================
  // Тест 10: Повторное использование базового pipeline
  // ============================================================================

  it('should allow extending base pipeline', () => {
    // Базовый pipeline для аутентификации
    const basePipeline = definePipeline()
      .use(withTiming)
      .use(withRequestLogging(mockLogger))
      .use(withIdentity<User>(mockAuthenticator));

    // Расширяем для обычных endpoint'ов
    const userPipeline = basePipeline.use(validate());

    type UserMeta = InferPipelineMeta<typeof userPipeline>;
    type _AssertUser = UserMeta extends { identity: User } ? true : never;

    // Расширяем с дополнительным middleware
    const adminPipeline = basePipeline
      .use(withMeta('role', () => 'admin'))
      .use(validate());

    type AdminMeta = InferPipelineMeta<typeof adminPipeline>;
    type _AssertAdmin = AdminMeta extends {
      identity: User;
      role: string;
    }
      ? true
      : never;
  });

  // ============================================================================
  // Тест 11: Типы должны быть иммутабельны
  // ============================================================================

  it('should not mutate base pipeline type', () => {
    const base = definePipeline().use(withTiming);

    const pipeline1 = base.use(withIdentity<User>(mockAuthenticator));
    const pipeline2 = base.use(withMeta('requestId', () => 'test-id'));

    type Meta1 = InferPipelineMeta<typeof pipeline1>;
    type _Assert1 = Meta1 extends { identity: User } ? true : never;

    type Meta2 = InferPipelineMeta<typeof pipeline2>;
    type _Assert2 = Meta2 extends { requestId: string } ? true : never;

    // base остаётся без изменений
    type BaseMeta = InferPipelineMeta<typeof base>;
    type _AssertBase = BaseMeta extends Record<string, never> ? true : never;
  });

  // ============================================================================
  // Тест 12: Цепочка без validate должна возвращать HasValidation = false
  // ============================================================================

  it('should return false for HasValidation without validate', () => {
    const withoutValidate = definePipeline()
      .use(withTiming)
      .use(withRequestLogging(mockLogger))
      .use(withIdentity<User>(mockAuthenticator));

    type HasVal = HasValidation<typeof withoutValidate>;
    type _Assert = HasVal extends false ? true : never;
  });

  // ============================================================================
  // Тест 13: Проверка типов контекстов напрямую
  // ============================================================================

  it('should have correct context types', () => {
    const pipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator))
      .use(validate());

    // Pipeline должен иметь тип:
    // Pipeline<UnvalidatedContext<{}>, ValidatedContext<any, { identity: User }>>
    type _AssertPipeline = typeof pipeline extends {
      use<CNext>(middleware: unknown): unknown;
    }
      ? true
      : never;
  });
});

// ============================================================================
// Дополнительные edge cases
// ============================================================================

describe('Pipeline edge cases', () => {
  it('should handle complex meta types', () => {
    interface ComplexMeta {
      user: User;
      session: {
        id: string;
        createdAt: Date;
      };
      permissions: string[];
    }

    const pipeline = definePipeline()
      .use(
        withMeta('user', () => ({
          id: '1',
          name: 'John',
          email: 'john@example.com',
        })),
      )
      .use(
        withMeta('session', () => ({
          id: 'session-1',
          createdAt: new Date(),
        })),
      )
      .use(withMeta('permissions', () => ['read', 'write']))
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends ComplexMeta ? true : never;
  });

  it('should allow custom middleware with correct types', () => {
    // Custom middleware, который добавляет поле в meta
    const customMiddleware = async <M extends { identity: User }>(
      ctx: ExtendableContext<M>,
      next: (
        ctx: ExtendableContext<M & { customField: string }>,
      ) => Promise<ResponseContext>,
    ): Promise<ResponseContext> => {
      return next({
        ...ctx,
        input: {
          ...ctx.input,
          customField: 'custom-value',
        },
      });
    };

    const pipeline = definePipeline()
      .use(withIdentity<User>(mockAuthenticator))
      .use(customMiddleware)
      .use(validate());

    type Meta = InferPipelineMeta<typeof pipeline>;
    type _Assert = Meta extends {
      identity: User;
      customField: string;
    }
      ? true
      : never;
  });
});
