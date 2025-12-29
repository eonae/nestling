# Migration Guide: Упрощённая версия defineSchemaFrom

## Что изменилось?

### Старая реализация
```typescript
type Narrowed<T> = /* сложная рекурсивная генерация 2^N вариантов */

export function defineSchemaFrom<TInput>(
  schema: z.ZodType<Narrowed<TInput>>
): typeof schema
```

**Проблемы:**
- Экспоненциальный рост вариантов (2^N)
- Сложная реализация (~150 строк вспомогательных типов)
- Различие между примитивами и объектами
- Не масштабируется на большое количество полей

### Новая реализация
```typescript
type IsNotWeaker<S, T> = S extends T ? true : false;
type HasNoExtraKeys<S, T> = [keyof S] extends [keyof T] ? true : false;

export function defineSchemaFrom<TDomain extends object>() {
  return <S extends z.ZodTypeAny>(
    schema: S &
      (IsNotWeaker<z.infer<S>, TDomain> extends true ? unknown : { ERROR: '...' }) &
      (HasNoExtraKeys<z.infer<S>, TDomain> extends true ? unknown : { ERROR: '...' })
  ): S => schema;
}
```

**Преимущества:**
- ✅ Простая реализация (2 вспомогательных типа)
- ✅ Нет 2^N проблемы
- ✅ Масштабируется на любое количество полей
- ✅ Естественное использование TypeScript type system
- ✅ Строгая проверка на лишние ключи

## Изменения в API

### Currying

**Было:**
```typescript
const schema = defineSchemaFrom<UserProto>(
  z.object({ ... })
);
```

**Стало:**
```typescript
const schema = defineSchemaFrom<UserProto>()(
  z.object({ ... })
);
```

Обратите внимание на **двойные скобки** `()()` - это currying для лучшего type inference.

## Изменения в семантике

### 1. Примитивы теперь можно делать required

**Старая версия:**
```typescript
type Domain = {
  name?: string;  // примитив - НЕЛЬЗЯ было делать required
  age?: number;   // примитив - НЕЛЬЗЯ было делать required
}

// ❌ Старая версия запрещала:
const schema = defineSchemaFrom<Domain>(
  z.object({
    name: z.string(),  // ❌ ошибка!
    age: z.number(),   // ❌ ошибка!
  })
);
```

**Новая версия:**
```typescript
type Domain = {
  name?: string;
  age?: number;
}

// ✅ Новая версия разрешает:
const schema = defineSchemaFrom<Domain>()(
  z.object({
    name: z.string(),  // ✅ ok
    age: z.number(),   // ✅ ok
  })
);
```

**Обоснование:** Упрощение. Различие между примитивами и объектами было искусственным. Главное - запретить ослабление типов (required → optional), а не различать примитивы.

### 2. Проверка лишних ключей

**Новая версия строго проверяет:**
```typescript
type Domain = {
  name: string;
  age: number;
}

// ❌ Ошибка компиляции:
const schema = defineSchemaFrom<Domain>()(
  z.object({
    name: z.string(),
    age: z.number(),
    extra: z.string(), // ❌ ERROR: Schema has extra keys not in domain type
  })
);
```

**Ограничение:** Проверка работает только на верхнем уровне объекта. Лишние ключи во вложенных объектах не отлавливаются.

## Что осталось без изменений

### 1. Запрет ослабления типов

```typescript
type Domain = {
  name: string;  // required
}

// ❌ Ошибка компиляции (как и раньше):
const schema = defineSchemaFrom<Domain>()(
  z.object({
    name: z.string().optional(), // ❌ ERROR: Schema is weaker than domain type
  })
);
```

### 2. Запрет забытых полей

```typescript
type Domain = {
  name: string;
  age: number;
}

// ❌ Ошибка компиляции (как и раньше):
const schema = defineSchemaFrom<Domain>()(
  z.object({
    name: z.string(),
    // ❌ ERROR: Schema is weaker than domain type (нет age)
  })
);
```

### 3. Разрешение сужения типов

```typescript
type Domain = {
  address?: {
    city: string;
  }
}

// ✅ Правильно (как и раньше):
const schema = defineSchemaFrom<Domain>()(
  z.object({
    address: z.object({  // optional → required ✅
      city: z.string(),
    }),
  })
);
```

## Миграция кода

### Шаг 1: Добавить вторые скобки

Найти все вызовы:
```typescript
defineSchemaFrom<Type>(schema)
```

Заменить на:
```typescript
defineSchemaFrom<Type>()(schema)
```

### Шаг 2: Проверить ошибки компиляции

После миграции могут появиться новые ошибки:

1. **Лишние ключи** - удалите их из схемы
2. **Примитивы стали required** - это теперь разрешено, проверьте что это желаемое поведение

### Шаг 3: Обновить импорты (если нужно)

Импорты остались без изменений:
```typescript
import { defineSchemaFrom } from '@nestling/transport';
```

## Примеры миграции

### Пример 1: Простая схема

**Было:**
```typescript
interface UserProto {
  name?: string;
  email?: string;
}

const UserSchema = defineSchemaFrom<UserProto>(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
  })
);
```

**Стало:**
```typescript
interface UserProto {
  name?: string;
  email?: string;
}

const UserSchema = defineSchemaFrom<UserProto>()(
  z.object({
    name: z.string().min(1),
    email: z.string().email(),
  })
);
```

### Пример 2: Вложенные объекты

**Было:**
```typescript
interface CreateUserProto {
  name: string;
  address?: {
    street: string;
    city: string;
  };
}

const CreateUserSchema = defineSchemaFrom<CreateUserProto>(
  z.object({
    name: z.string().min(1),
    address: z.object({
      street: z.string(),
      city: z.string(),
    }),
  })
);
```

**Стало:**
```typescript
interface CreateUserProto {
  name: string;
  address?: {
    street: string;
    city: string;
  };
}

const CreateUserSchema = defineSchemaFrom<CreateUserProto>()(
  z.object({
    name: z.string().min(1),
    address: z.object({
      street: z.string(),
      city: z.string(),
    }),
  })
);
```

## FAQ

### Q: Почему currying?

**A:** Currying `<T>()()` позволяет TypeScript правильно выводить типы. Без него type inference работает хуже.

### Q: Можно ли вернуть старое поведение для примитивов?

**A:** Да, но это усложнит реализацию. Текущее решение - упрощение, которое покрывает 99% use cases.

### Q: Почему лишние ключи проверяются только на верхнем уровне?

**A:** Рекурсивная проверка возможна, но значительно усложняет типы. Для большинства случаев достаточно проверки верхнего уровня.

### Q: Что делать, если нужна глубокая проверка ключей?

**A:** Можно добавить runtime проверку или использовать `.strict()` в zod-схемах:
```typescript
z.object({
  user: z.object({
    id: z.string(),
  }).strict(), // запретит лишние ключи на runtime
}).strict()
```

## Заключение

Новая версия проще, быстрее и масштабируется лучше. Миграция минимальна - достаточно добавить вторые скобки `()`.

Если у вас возникли проблемы с миграцией, создайте issue с примером кода.

