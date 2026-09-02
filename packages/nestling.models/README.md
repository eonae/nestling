# @nestling/models

Модели входных и выходных данных на zod: схема с валидацией и выводом типов,
которую можно сверить с уже существующим TypeScript-типом.

> 🛰️ **Сателлит на zod, вне ядра V1.** Ядро Nestling принимает любую
> [Standard Schema](https://standardschema.dev) и схемы не разбирает. Этот
> пакет делает обратное: сверка схемы с существующим типом по полям требует
> zod-специфичных типов (`z.ZodObject<infer Shape>`, `z.input<S>`), поэтому
> у пакета есть `peerDependencies.zod`. Пакет находится в активной
> разработке, API может меняться.

## Установка

```bash
yarn add @nestling/models zod
# или
npm install @nestling/models zod
```

Пакет требует `zod@^4.0.0` как peer-зависимость.

## Минимальный пример

```typescript
import { fromType } from '@nestling/models';
import { z } from 'zod';

// Тип уже существует: например, сгенерирован из proto
interface UserProto {
  name?: string;
  email?: string;
  age?: number;
}

const UserModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.email(),
    age: z.number().min(0).max(150),
  }),
);

// Тип результата строже исходного: все поля стали обязательными
// type User = { name: string; email: string; age: number }
const user = UserModel.parse({ name: 'Alice', email: 'alice@example.com', age: 30 });
```

Компилятор проверяет, что схема описывает именно `UserProto`: лишнее поле
или несовместимый тип — ошибка компиляции.

## Основные понятия

### Два способа объявить модель

Zod сам выводит тип из схемы. Проблема появляется, когда тип уже есть:
сгенерирован из proto-операций, GraphQL или OpenAPI. Тогда схему нужно
держать в согласии с этим типом, и пакет даёт для этого два конструктора.

| Конструктор | Когда использовать | Что делает |
|---|---|---|
| `fromScratch().makeModel(schema)` | типа ещё нет | возвращает схему как есть; тип выводится из неё |
| `fromType<T>().makeModel(schema)` | тип `T` уже существует | возвращает схему и проверяет на этапе компиляции, что её вход — сужение `T` |

```typescript
import { fromScratch } from '@nestling/models';
import { z } from 'zod';

const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1).max(100),
    email: z.email(),
    age: z.number().min(0).max(150),
  }),
);

// type User = { name: string; email: string; age: number }
```

Обе функции возвращают обычную zod-схему: у результата есть `parse`,
`parseAsync`, `shape` и всё остальное, что даёт zod.

### Сужение типа

`fromType<T>()` разрешает схеме быть строже типа `T`, но не шире.

Разрешено:

- сделать необязательное поле обязательным: `string | undefined` в типе,
  `z.string()` в схеме;
- сузить тип: `string` в типе, `z.enum(['admin', 'user'])` в схеме;
- добавить ограничения: `z.number().min(0).max(100)`.

Запрещено, и это ошибка компиляции:

- добавить поле, которого нет в `T`;
- сделать обязательное поле необязательным;
- поменять тип на несовместимый: `string` на `number`.

```typescript
interface CreateUserProto {
  name?: string;
  email?: string;
  role?: string;
  age?: number;
}

const CreateUserModel = fromType<CreateUserProto>().makeModel(
  z.object({
    name: z.string().min(1),           // необязательное стало обязательным
    email: z.email(),                  // то же
    role: z.enum(['admin', 'user']),   // string сужен до перечисления
    age: z.number().min(18).max(100),  // добавлены ограничения
  }),
);

// type CreateUser = { name: string; email: string; role: 'admin' | 'user'; age: number }
```

Примеры ошибок:

```typescript
interface UserProto {
  name?: string;
}

// Ошибка: поля `age` нет в UserProto
const BadModel = fromType<UserProto>().makeModel(
  z.object({
    name: z.string(),
    age: z.number(),
  }),
);

// Ошибка: `name` в типе — string, в схеме — number
const BadModel2 = fromType<UserProto>().makeModel(
  z.object({
    name: z.number(),
  }),
);

interface UserWithRequired {
  name: string;
}

// Ошибка: обязательное поле нельзя сделать необязательным
const BadModel3 = fromType<UserWithRequired>().makeModel(
  z.object({
    name: z.string().optional(),
  }),
);
```

Сообщение об ошибке компиляции называет путь к полю (`__FIELD_ERROR__`,
`__EXTRA_FIELD__`), ожидаемый и полученный типы и подсказку.

### Вложенные объекты

Сужение проверяется рекурсивно: правила выше действуют на каждом уровне
вложенности.

```typescript
interface UserProto {
  profile?: {
    firstName?: string;
    lastName?: string;
    address?: {
      street?: string;
      city?: string;
    };
  };
}

const UserModel = fromType<UserProto>().makeModel(
  z.object({
    profile: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      address: z.object({
        street: z.string(),
        city: z.string(),
      }),
    }),
  }),
);

// Все вложенные поля стали обязательными
```

### Преобразования

Схема может преобразовывать данные при разборе. Проверка сужения смотрит на
**вход** схемы (`z.input<S>`), поэтому выход может отличаться от `T`.

```typescript
interface GetUserProto {
  id?: string;
  createdAt?: string;
}

const GetUserModel = fromType<GetUserProto>().makeModel(
  z.object({
    id: z.string().transform((val) => parseInt(val, 10)),      // строка в число
    createdAt: z.string().transform((val) => new Date(val)),   // строка в Date
  }),
);

const result = GetUserModel.parse({ id: '42', createdAt: '2024-01-01T00:00:00Z' });
// result = { id: 42, createdAt: Date(...) }
```

Преобразования можно объединять в цепочку:

```typescript
const UserModel = fromScratch().makeModel(
  z.object({
    email: z
      .email()
      .transform((val) => val.toLowerCase())
      .transform((val) => val.trim()),
  }),
);
```

### Валидация и ошибки

`parse` бросает стандартный `ZodError`; `parseAsync` нужен для асинхронных
проверок (`refine` с промисом).

```typescript
import { z } from 'zod';

const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1, 'Имя не может быть пустым'),
    age: z.number().min(0).max(150, 'Возраст должен быть от 0 до 150'),
  }),
);

try {
  UserModel.parse({ name: '', age: 200 });
} catch (error) {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) {
      console.log(`${issue.path.join('.')}: ${issue.message}`);
    }
  }
}
```

### Описания полей

`.describe()` добавляет описание, которое попадает в JSON Schema и OpenAPI:

```typescript
const UserModel = fromScratch().makeModel(
  z.object({
    name: z.string().min(1).max(100).describe('Имя пользователя, от 1 до 100 символов'),
    email: z.email().describe('Адрес электронной почты'),
    role: z.enum(['admin', 'user', 'guest']).describe('Роль в системе'),
  }),
);
```

## Справочник API

| Экспорт | Сигнатура | Что делает |
|---|---|---|
| `fromScratch()` | `() => { makeModel<S>(schema: S): S }` | возвращает схему без проверки против типа |
| `fromType<T>()` | `() => { makeModel<S>(schema: S & SchemaConstraint<S, T>): S }` | возвращает схему; на этапе компиляции проверяет, что `z.input<S>` — сужение `T` |
| `makeModel(schema)` | `<S>(schema: S) => S` | то же, что `fromScratch().makeModel(schema)` |

Все три функции ничего не делают в рантайме: они возвращают переданную
схему. Вся работа происходит в типах.

## Границы пакета

Пакет не валидирует данные сам, не регистрируется в контейнере и не
подключается к транспортам: он возвращает zod-схему, которую вы передаёте
в `input`/`output` endpoint'а или вызываете напрямую.

## Ссылки

- [Документация zod](https://zod.dev/)
