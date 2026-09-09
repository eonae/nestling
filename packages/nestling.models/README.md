# @nestling/models

Модели входных и выходных данных на zod: схема с валидацией и выводом типов,
которую компилятор сверяет с уже существующим TypeScript-типом. Нужно это
там, где тип задан заранее — сгенерирован из proto, GraphQL или OpenAPI, — и
схема обязана его описывать.

> 🛰️ Сателлит на zod, вне ядра V1: у пакета есть `peerDependencies.zod`, API
> может меняться.
> Дизайн: [`docs/design/schemas.md`](../../docs/design/schemas.md).
> Гайд: [глава 3. Проверить вход](../../docs/guide/03-input.md).

## Установка

```bash
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

// Тип результата строже исходного: все поля стали обязательными.
// Лишнее поле в схеме или несовместимый тип — ошибка компиляции.
const user = UserModel.parse({ name: 'Alice', email: 'a@b.c', age: 30 });
```

## Экспорты

| Имя | Что делает |
|---|---|
| `fromType` | `fromType<T>().makeModel(schema)` — проверяет на компиляции, что `z.input<S>` сужает `T` |
| `fromScratch` | `fromScratch().makeModel(schema)` — возвращает схему без сверки с типом |
| `makeModel` | то же, что `fromScratch().makeModel(schema)` |

Все три функции ничего не делают в рантайме: они возвращают переданную схему.
Вся работа происходит в типах.

## Границы пакета

Пакет не валидирует данные сам, не регистрируется в контейнере и не
подключается к транспортам. Он отдаёт zod-схему, которая передаётся в
`input`/`output` endpoint'а или вызывается напрямую.
