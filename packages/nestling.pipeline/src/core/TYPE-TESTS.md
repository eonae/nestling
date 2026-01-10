# Типовые тесты Pipeline

Этот каталог содержит типовые тесты для проверки корректности типов в системе Pipeline.

## Файлы

### `pipeline.types.spec.ts`
Позитивные тесты, проверяющие:
- Правильную типизацию цепочки middleware
- Накопление meta-полей
- Совместимость типов контекстов
- Работу утилит типов (`InferPipelineMeta`, `HasValidation`)

### `pipeline.negative.types.spec.ts`
Дополнительные тесты, проверяющие:
- Граничные случаи
- Иммутабельность pipeline
- Отсутствие полей в meta
- Сложные типы

## Как они работают

Эти тесты **не выполняются в runtime**. Они проверяются только на этапе компиляции TypeScript.

### Проверка типов

Для проверки типов используйте TypeScript компилятор:

```bash
# Из корня проекта
npx tsc --noEmit

# Или из директории пакета
cd packages/nestling.pipeline
npx tsc --noEmit
```

### Формат тестов

Тесты используют несколько паттернов:

#### 1. Type Assertions
```typescript
type Meta = InferPipelineMeta<typeof pipeline>;
type _Assert = Meta extends { identity: User } ? true : never;
const _check: _Assert = true; // ✅ Компилируется, если тип правильный
```

#### 2. Проверка наличия полей
```typescript
type HasField<T, K extends string> = K extends keyof T ? true : false;

type Check = HasField<Meta, 'identity'>;
const _assert: Check = true; // ✅ Поле есть
const _assert: Check = false; // ❌ Ошибка компиляции, если поле есть
```

#### 3. Проверка отсутствия полей
```typescript
type Check = HasField<Meta, 'nonExistent'>;
const _assert = false as const; // ✅ Проверяем, что поле отсутствует
type _Validate = Check extends false ? true : never; // Дополнительная проверка
```

## Что проверяется

### ✅ Правильные комбинации

1. **Цепочка middleware в правильном порядке**
   ```typescript
   definePipeline()
     .use(withTiming)
     .use(withLogging(logger))
     .use(withIdentity<User>(auth))
     .use(validate());
   ```

2. **Накопление meta через цепочку**
   ```typescript
   definePipeline()
     .use(withMeta('requestId', ...))  // meta: { requestId }
     .use(withIdentity<User>(...))     // meta: { requestId, identity }
     .use(validate());
   ```

3. **withTiming работает везде**
   ```typescript
   definePipeline()
     .use(withTiming)           // ✅ До validate
     .use(validate())
     .use(withTiming);          // ✅ После validate
   ```

### ❌ Неправильные комбинации

Эти комбинации **должны** вызывать ошибки TypeScript:

1. **Raw-middleware после validate()**
   ```typescript
   definePipeline()
     .use(validate())
     .use(withLogging(logger)); // ❌ Нет доступа к raw.transport
   ```

2. **Повторный validate()**
   ```typescript
   definePipeline()
     .use(validate())
     .use(validate()); // ❌ Второй validate получает ValidatedContext
   ```

## Интеграция с CI

Типовые тесты автоматически проверяются при:
- `tsc --noEmit` (проверка типов)
- `eslint` (проверка стиля и корректности)
- Build процессе

## Добавление новых тестов

При добавлении новых middleware или изменении типов Pipeline:

1. Добавьте позитивный тест в `pipeline.types.spec.ts`
2. Проверьте, что тест компилируется: `npx tsc --noEmit`
3. При необходимости добавьте проверку граничных случаев в `pipeline.negative.types.spec.ts`

## Примечания

- Тесты используют `eslint-disable @typescript-eslint/no-unused-vars` т.к. переменные типов не используются в runtime
- Префикс `_` в именах переменных указывает, что они используются только для проверки типов
- `describe` и `it` блоки помогают организовать тесты, но не выполняются
