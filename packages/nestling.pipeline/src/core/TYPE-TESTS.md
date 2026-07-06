# Типовые тесты Pipeline

Этот каталог содержит типовые тесты для проверки корректности типов в системе Pipeline.

## Файлы

### `pipeline.spec.ts`
Единый файл с типовыми тестами, проверяющий:
- Правильную типизацию цепочки middleware
- Накопление input-полей через middleware
- Совместимость типов контекстов
- Работу утилит типов (`InferPipelineInput`)
- Граничные случаи и иммутабельность pipeline

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
type InputType = InferPipelineInput<typeof pipeline>;
type _Assert = InputType extends { identity: User; payload: unknown } ? true : never;
const _check: _Assert = true; // ✅ Компилируется, если тип правильный
```

#### 2. Проверка наличия полей
```typescript
type HasField<T, K extends string> = K extends keyof T ? true : false;

type Check = HasField<InputType, 'identity'>;
const _assert: Check = true; // ✅ Поле есть
const _assert: Check = false; // ❌ Ошибка компиляции, если поле есть
```

#### 3. Проверка отсутствия полей
```typescript
type Check = HasField<InputType, 'nonExistent'>;
const _assert = false as const; // ✅ Проверяем, что поле отсутствует
type _Validate = Check extends false ? true : never; // Дополнительная проверка
```

## Что проверяется

### ✅ Правильные комбинации

1. **Цепочка middleware в правильном порядке**
   ```typescript
   definePipeline()
     .use(withTiming)                    // input: { timestamp: number }
     .use(withRequestLogging(logger))     // input: { timestamp: number }
     .use(withIdentity<User>(auth))       // input: { timestamp: number, identity: User }
     .use(validate());                    // input: { timestamp: number, identity: User, payload: unknown }
   ```

2. **Накопление input через цепочку**
   ```typescript
   definePipeline()
     .use(addField({ requestId: 'id-1' }))  // input: { requestId: string }
     .use(withIdentity<User>(...))           // input: { requestId: string, identity: User }
     .use(validate());                       // input: { requestId: string, identity: User, payload: unknown }
   ```

3. **withTiming работает везде**
   ```typescript
   definePipeline()
     .use(withTiming)           // ✅ До validate
     .use(validate())
     .use(withTiming);          // ✅ После validate (добавляет timestamp в существующий input)
   ```

4. **Inline middleware для добавления полей**
   ```typescript
   definePipeline()
     .use(addField({ sessionId: 'session-1' }))  // input: { sessionId: string }
     .use(addField({ traceId: 'trace-1' }))      // input: { sessionId: string, traceId: string }
     .use(validate());
   ```

### ❌ Неправильные комбинации

Эти комбинации **должны** вызывать ошибки TypeScript:

1. **Перезапись существующих полей**
   ```typescript
   definePipeline()
     .use(withTiming)                    // input: { timestamp: number }
     .use(addField({ timestamp: 123 })); // ❌ Ошибка: timestamp уже существует
   ```

2. **Неправильный порядок типов**
   ```typescript
   definePipeline()
     .use(withIdentity<User>(auth))      // требует EmptyInput
     .use(addField({ requestId: 'id' })) // требует EmptyInput, но получил { identity: User }
     // ❌ Ошибка типовой несовместимости
   ```

## Интеграция с CI

Типовые тесты автоматически проверяются при:
- `tsc --noEmit` (проверка типов)
- `eslint` (проверка стиля и корректности)
- Build процессе

## Добавление новых тестов

При добавлении новых middleware или изменении типов Pipeline:

1. Добавьте тест в `pipeline.spec.ts`
2. Используйте `addField()` для создания inline middleware в тестах
3. Проверьте, что тест компилируется: `npx tsc --noEmit`
4. Убедитесь, что типы правильно накапливаются через цепочку

## Примечания

- Тесты используют `eslint-disable @typescript-eslint/no-unused-vars` т.к. переменные типов не используются в runtime
- Префикс `_` в именах переменных указывает, что они используются только для проверки типов
- `describe` и `it` блоки помогают организовать тесты, но не выполняются
- Middleware теперь работают в режиме "before-only" - они возвращают объект с добавляемыми полями, не вызывают `next()`
- `input` накапливается через цепочку middleware, включая `payload` после `validate()`
- Используйте `InferPipelineInput<typeof pipeline>` для извлечения типа накопленного input