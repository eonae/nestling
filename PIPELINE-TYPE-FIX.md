# Исправление вывода типов для Pipeline

## Проблема

Типы обоих пайплайнов выводились одинаково:

```typescript
const basePipeline = definePipeline().use(withTiming()).use(validate());
const noValidationPipeline = definePipeline().use(withTiming());

// Оба имели тип:
// Pipeline<UnvalidatedContext<AnyMeta>, ValidatedContext<AnyInput, AnyMeta>>
```

## Причина

1. Метод `Pipeline.use<CNext extends AnyContext = AnyContext>()` имел дефолтное значение `= AnyContext` для generic параметра `CNext`
2. Функция `withTiming<C extends AnyContext = AnyContext>()` также имела дефолтное значение для generic параметра
3. При вызове `withTiming()` TypeScript использовал дефолтные значения вместо вывода конкретного типа из контекста

## Решение

### 1. Убрали дефолтное значение из `Pipeline.use()`

```typescript
// Было:
use<CNext extends AnyContext = AnyContext>(
  middleware: Middleware<COut, CNext>,
): Pipeline<CIn, CNext>

// Стало:
use<CNext extends AnyContext>(
  middleware: Middleware<COut, CNext>,
): Pipeline<CIn, CNext>
```

### 2. Изменили `withTiming` с функции-фабрики на middleware-функцию

```typescript
// Было:
export function withTiming<C extends AnyContext = AnyContext>(): MiddlewareFn<C, C> {
  return async (ctx, next) => { /* ... */ };
}

// Использование:
definePipeline().use(withTiming())
//                              ^^ скобки - вызов функции

// Стало:
export function withTiming<C extends AnyContext>(
  ctx: C,
  next: (ctx: C) => Promise<any>,
): Promise<any> {
  // ... реализация
}

// Использование:
definePipeline().use(withTiming)
//                              ^^ без скобок - передаем саму функцию
```

## Результат

Теперь типы выводятся правильно:

```typescript
const basePipeline = definePipeline().use(withTiming).use(validate());
// Тип: Pipeline<UnvalidatedContext<AnyMeta>, ValidatedContext<AnyInput, AnyMeta>>

const noValidationPipeline = definePipeline().use(withTiming);
// Тип: Pipeline<UnvalidatedContext<AnyMeta>, UnvalidatedContext<AnyMeta>>
```

## Изменённые файлы

1. `packages/nestling.pipeline/src/core/pipeline.ts` - убрали дефолт из `use()`
2. `packages/nestling.pipeline/src/middlewares/timing.ts` - изменили `withTiming()` на `withTiming`
3. `packages/examples.app-with-http/src/common/pipelines.ts` - обновили использование
4. `packages/examples.simple-http-server/src/endpoints.functional/*.ts` - обновили использование
5. `packages/examples.simple-cli/src/main.ts` - обновили использование
