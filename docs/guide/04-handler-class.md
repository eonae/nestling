# 4. Хендлер как класс

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-04).
> Целевое описание: [design/endpoints.md](../design/endpoints.md) §3.
> Почему так: запись [ideas.md](../decisions/ideas.md) «[2026-09-03] Поле
> `handler`: зависимости принадлежат хендлеру; канон `return`;
> `Output<T, typeof Def>`».

Хендлеры из предыдущих глав лежат функциями внутри словаря декларации.
Такой хендлер трудно тестировать отдельно: чтобы вызвать его, нужно
достать его из декларации. Хендлер нужно вынести в отдельное значение,
которое видно тесту и в которое дальше можно добавить зависимости.

```typescript
// packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts
import { Injectable } from '@nestling/container';
import type { Output } from '@nestling/pipeline';
import { httpEndpoint } from '@nestling/transport.http';
import { z } from 'zod';

const ListUsersInput = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

type ListUsersInput = z.infer<typeof ListUsersInput>;

@Injectable()
export class ListUsersHandler {
  async handle(input: ListUsersInput): Output<User[]> {
    return [alice, bob].slice(0, input.limit ?? 20);
  }
}

export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  handler: ListUsersHandler,
});
```

Класс объявляет метод `handle` с той же сигнатурой, что была у функции:
входные данные и необязательный `meta`. Декоратор `@Injectable()` без
аргумента помечает класс как узел графа без зависимостей.

Поле `handler` принимает класс. `implements` не нужен: сигнатуру `handle`
сверяет со схемами `input` и `output` сам конструктор декларации в точке
декларации. Хендлер, который возвращает объект другой формы, не
компилируется на строке `handler: ListUsersHandler`.

## Экземпляр создаёт фреймворк

Endpoint регистрирует класс-хендлер сам: при сборке он добавляет
провайдер этого класса в модуль той единицы, которая объявила endpoint.
`new` в коде приложения не нужен, зависимости приходят в конструктор.
Перечислять класс в `providers:` фичи не нужно:

```typescript
// packages/examples.users-service/src/users.feature.ts
export const UsersFeature = makeFeature({
  name: 'users',
  providers: [
    // сервисы фичи; классов-хендлеров здесь нет
  ],
  endpoints: [ListUsers, GetUser, CreateUser],
});
```

Класс, перечисленный и в `handler`, и в `providers:`, останавливает
сборку на фазе ASSEMBLE, а не даёт два экземпляра: у узла графа один
источник. Сообщение называет класс, паттерн endpoint'а и модуль, в
котором нашлась вторая регистрация.

Экземпляр создаётся один раз, при сборке приложения, и переиспользуется
между запросами — как обычный singleton контейнера. Хранить в поле
данные одного запроса нельзя: они утекут в следующий. Всё, что относится
к запросу, приходит аргументами `handle`.

На самом классе нет метаданных endpoint'а: адрес, схемы и отказы живут в
декларации. Поэтому один и тот же класс можно поставить хендлером двум
endpoint'ам, и они разделят один экземпляр: класс служит себе токеном, и
провайдер регистрируется один раз.

## Юнит-тест без фреймворка

Класс — обычное значение, поэтому тест создаёт его через `new`:

```typescript
// packages/examples.users-service/src/users/endpoints/create-user.endpoint.spec.ts
import { CreateUserHandler } from './create-user.endpoint';

it('возвращает отказ EmailTaken для занятого email', async () => {
  const handler = new CreateUserHandler(inMemoryUsersRepo([alice]));

  const result = await handler.handle({ name: 'Alice II', email: alice.email });

  expect(EmailTaken.is(result)).toBe(true);
});
```

Ни контейнера, ни транспорта, ни импортов из `@nestling/app` такому
тесту не нужно. Аргумент конструктора здесь — фейк хранилища. Тест,
который вызывает endpoint через полный пайплайн, проверяет тот же класс
другим способом — через декларацию, а не через `new`.

```bash
yarn workspace examples.users-service test
```

## Три формы поля `handler`

Класс — не единственная форма. Поле `handler` принимает три:

| Форма | Запись | Когда |
|---|---|---|
| функция | `handler: async (input, meta) => …` | зависимостей нет, хендлер в две строки |
| объект с `deps` | `handler: { deps: [Token], handle: (dep) => async (input) => … }` | зависимости есть, класс не нужен |
| класс | `handler: SomeHandler` | зависимости есть, хендлер длиннее пары строк |

Классовая форма — канон этого гайда: она сохраняет привычную структуру
«конструктор плюс метод». Форма с `deps` описана в приложении А; на
поведение endpoint'а выбор формы не влияет.

Полей `deps` и `handle` на верхнем уровне словаря декларации нет:
зависимости принадлежат хендлеру, а не адресу и схемам. Их присутствие —
ошибка компиляции.

Хендлер стал классом, но данные всё ещё лежат в константах. Следующая
глава подключает хранилище: [5. Откуда хендлер берёт
репозиторий](./05-repository.md).
