# 6. Порт и адрес базы из окружения

> Гайд по текущему API; сверено с кодом `examples.users-service` (2026-09-04).
> Целевое описание: [design/config.md](../design/config.md). Почему так:
> записи [ideas.md](../decisions/ideas.md) «[2026-07-08] Kernel/user
> space; конфиг как token-families; плагины» и «[2026-07-13] Конфиг:
> `secret()` и общие ключи».

Порт, адрес базы и токен API должны приходить из переменных окружения.
Секреты не должны попадать в логи. Если обязательной переменной нет,
приложение должно упасть при старте, а не отвечать `500` на первом
запросе.

```typescript
// packages/examples.users-service/src/app.config.ts
import { from, makeConfig, secret } from '@nestling/config';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .describe('Размер страницы списка пользователей'),
  databaseUrl: secret(
    from(
      'DATABASE_URL',
      z
        .url()
        .default('postgresql://localhost:5432/users')
        .describe('Адрес базы данных'),
    ),
  ),
  apiToken: secret(
    from(
      'API_TOKEN',
      z.string().min(1).describe('Bearer-токен для запросов, меняющих данные'),
    ),
  ),
});
```

Секция — объект с префиксом, где каждому полю соответствует схема. Имя
переменной выводится из префикса и имени поля, `from('NAME', schema)`
задаёт точное имя.

Описание поля пишется средствами схемы: `.describe()` у zod. Фреймворк
его не читает — оно нужно человеку, который открыл файл, и тому, кто
переносит таблицу переменных в документацию по развёртыванию.

| Переменная | Поле | Что задаёт | По умолчанию |
|---|---|---|---|
| `APP_PAGE_SIZE` | `pageSize` | размер страницы списка пользователей | `20` |
| `DATABASE_URL` | `databaseUrl` | адрес базы данных | `postgresql://localhost:5432/users` |
| `API_TOKEN` | `apiToken` | токен для запросов, меняющих данные | нет, переменная обязательна |
| `HTTP_PORT` | секция транспорта | порт HTTP-сервера | `3000` |
| `HTTP_HOST` | секция транспорта | адрес прослушивания | `0.0.0.0` |

Значения окружения приходят строками. Число из строки делает схема,
поэтому у `pageSize` стоит `z.coerce.number()`.

## Секция как зависимость

```typescript
// packages/examples.users-service/src/users/endpoints/list-users.endpoint.ts
@Injectable([UsersRepository$, AppConfig])
export class ListUsersHandler {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: Config<typeof AppConfig>,
  ) {}

  async handle(input: ListUsersInput): Output<User[]> {
    const rows = await this.users.all();

    return rows.slice(0, input.limit ?? this.config.pageSize);
  }
}

export const ListUsers = httpEndpoint({
  method: 'GET',
  path: '/users',
  input: ListUsersInput,
  output: z.array(User),
  doc: { summary: 'Список пользователей', tags: ['users'] },
  pipeline: observability,
  handler: ListUsersHandler,
});
```

Секция инжектируется как обычная зависимость: токен `AppConfig` в списке
`@Injectable`. Регистрировать её в `providers` не нужно: узел графа
создаётся самим фактом упоминания. Тип значения даёт
`Config<typeof AppConfig>`: поле `config.pageSize` имеет тип `number`.

Так же секцию читает `Database`, как в главе 5:

```typescript
// packages/examples.users-service/src/database.ts
@Injectable([AppConfig, Logger$])
export class Database {
  // …
  @OnInit()
  connect(): void {
    // В лог уходит только хост: значение поля секретное
    this.logger.log(
      `database connected: ${new URL(this.config.databaseUrl).host}`,
    );
    // …
  }
}
```

```bash
API_TOKEN=secret APP_PAGE_SIZE=1 yarn workspace examples.users-service start:dev
curl 'localhost:3000/users'
```

## Секреты

`secret()` помечает поле, значение которого не должно попадать в вывод.
Для потребителя ничего не меняется: `config.databaseUrl` возвращает
настоящую строку. Меняется то, что печатает фреймворк. `console.log` и
`JSON.stringify` секции показывают `'***'` вместо значения, а ошибка
валидации заменяет сообщение валидатора на `<redacted>`.

За свои строки отвечает потребитель: `Database` пишет в лог только хост,
а не URL целиком. Секретное поле не печатается фреймворком ни в отчётах,
ни в ошибках — строки, которые пишет сам потребитель, фреймворк не
контролирует.

## Обязательные значения

У `apiToken` нет умолчания. Запустите приложение без `API_TOKEN`:

```
failed to start: ConfigValidationError: Config section 'app' is invalid:
  - API_TOKEN (field 'apiToken'): Invalid input: expected string, received undefined
Sources consulted, in priority order: process.env
```

```bash
yarn workspace examples.users-service start:dev   # без API_TOKEN: ошибка при старте
```

Секция проверяется при сборке графа, до `@OnInit` и до открытия сокета.
Все проваленные поля секции собираются в одну ошибку. Значение, которое
не задано, в тексте ошибки не скрывается: «ключ не задан» и есть то, что
нужно увидеть. `process.env` читает ядро, и только оно: секция описывает,
что именно читается, а потребитель получает типизированный объект.

У транспорта своя секция с тем же правилом: ключи `HTTP_PORT` и
`HTTP_HOST`, по умолчанию `3000` и `0.0.0.0`. Опция `http({ port: 8080 })`
имеет приоритет над переменной. Тестовой сборке порт не нужен вовсе: она
не открывает сокет.

```bash
API_TOKEN=secret HTTP_PORT=8080 yarn workspace examples.users-service start:dev
curl localhost:8080/users
```

Сервис работает, и пора закрепить это тестами, которые не поднимают
сокет и не требуют базы. Следующая глава: [7. Убедиться, что работает,
без запуска сервера](./07-testing.md).
