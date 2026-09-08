# 7. Порт и адрес базы из окружения

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-09).
> Целевое описание: [design/config.md](../design/config.md). Почему так:
> записи [ideas.md](../decisions/ideas.md) «[2026-07-08] Kernel/user
> space; конфиг как token-families; плагины», «[2026-07-13] Конфиг:
> `secret()` и общие ключи» и «[2026-09-06] Конфиг: `derived`,
> `env({ prefix })`, описания полей через конвертеры».

Порт, адрес базы и Bearer-токен API должны приходить из переменных
окружения. Секреты не должны попадать в логи. Если обязательной
переменной нет, приложение должно упасть при старте, а не отвечать `500`
на первом запросе.

```typescript
// examples/users-service/src/app.config.ts
import { from, makeConfig, secret } from '@nestling/app';
import { z } from 'zod';

export const AppConfig = makeConfig(
  'app',
  {
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
  },
  (derived) => ({
    databaseHost: derived(['databaseUrl'], (url) => new URL(url).host),
  }),
);
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
| `API_TOKEN` | `apiToken` | Bearer-токен для запросов, меняющих данные | нет, переменная обязательна |
| `HTTP_PORT` | секция сервера | порт HTTP-сервера | `3000` |
| `HTTP_HOST` | секция сервера | адрес прослушивания | `0.0.0.0` |

Значения окружения приходят строками. Число из строки делает схема,
поэтому у `pageSize` стоит `z.coerce.number()`.

## Вычисляемое поле

Третий аргумент `makeConfig` объявляет поля, значения которых считаются
из других полей той же секции. `databaseHost` получает хост из адреса
базы, поэтому разбирать URL в каждом потребителе не нужно.

```typescript
// examples/users-service/src/app.config.ts
  (derived) => ({
    databaseHost: derived(['databaseUrl'], (url) => new URL(url).host),
  }),
```

`derived(deps, fn)` называет зависимости именами полей первого рекорда, а
`fn` получает их значения по порядку. Компилятор проверяет и имена, и
типы: `'databaseUrll'` не соберётся, и аннотация `(url: number)` тоже.
Переменной окружения у поля нет — в таблице выше его нет, и в `.keys`
секции оно не входит. Значение считается один раз, при валидации секции.

`databaseUrl` помечен `secret()`, поэтому `databaseHost` тоже секретен:
поле наследует секретность своих зависимостей. Правило одностороннее и
намеренно грубое — снять пометку нечем.

## Секция как зависимость

```typescript
// examples/users-service/src/users/endpoints/list-users.endpoint.ts
@Handler([UsersRepository$, AppConfig])
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

Секция инжектируется как обычная зависимость: DI-токен `AppConfig` в
списке декоратора роли. Регистрировать её в `providers` не нужно: узел
графа создаётся самим фактом упоминания. Тип значения даёт
`Config<typeof AppConfig>`: поле `config.pageSize` имеет тип `number`.

Так же секцию читает `Database`, как в главе 6:

```typescript
// examples/users-service/src/database.ts
@Resource([AppConfig, Logger$.auto])
export class Database {
  static async acquire(
    config: Config<typeof AppConfig>,
    logger: Logger,
    _signal: AbortSignal,
  ): Promise<Database> {
    // В лог уходит только хост, а не адрес целиком: хост считает
    // вычисляемое поле секции
    logger.info('database connected', { host: config.databaseHost });
    // …
  }
}
```

```bash
API_TOKEN=secret APP_PAGE_SIZE=1 yarn workspace @examples/users-service start:dev
curl 'localhost:3000/users'
```

## Секреты

`secret()` помечает поле, значение которого не должно попадать в вывод.
Для потребителя ничего не меняется: `config.databaseUrl` возвращает
настоящую строку. Меняется то, что печатает фреймворк. `console.log` и
`JSON.stringify` секции показывают `'***'` вместо значения, а ошибка
валидации заменяет сообщение валидатора на `<redacted>`.

За свои строки отвечает потребитель: `Database` пишет в лог только хост,
а не URL целиком. `databaseHost` унаследовал секретность от адреса,
поэтому печать секции покажет вместо него `'***'`; в лог его пишет
потребитель, и это его осознанное решение. Секретное поле не печатается
фреймворком ни в отчётах, ни в ошибках — строки, которые пишет сам
потребитель, фреймворк не контролирует.

## Обязательные значения

У `apiToken` нет умолчания. Запустите приложение без `API_TOKEN`:

```
failed to start: ConfigValidationError: Config section 'app' is invalid:
  - API_TOKEN (field 'apiToken'): Invalid input: expected string, received undefined
Sources consulted, in priority order: process.env
```

```bash
yarn workspace @examples/users-service start:dev   # без API_TOKEN: ошибка при старте
```

Секция проверяется при сборке графа, до создания экземпляров и до открытия сокета.
Все проваленные поля секции собираются в одну ошибку. Значение, которое
не задано, в тексте ошибки не скрывается: «ключ не задан» и есть то, что
нужно увидеть. `process.env` читает ядро, и только оно: секция описывает,
что именно читается, а потребитель получает типизированный объект.

Порт и хост читает не транспорт, а сервер — узел, который держит сокет.
Ключи у него свои: `HTTP_PORT` и `HTTP_HOST`, по умолчанию `3000` и
`0.0.0.0`. Опции адреса у `http()` нет вовсе: адрес меняется без
пересборки образа, поэтому задаётся он только переменной. Второй сервер
получает свои ключи по имени: `httpServer({ name: 'admin' })` читает
`HTTP_ADMIN_PORT` и `HTTP_ADMIN_HOST`. Тестовой сборке порт не нужен
вовсе: она не открывает сокет.

```bash
API_TOKEN=secret HTTP_PORT=8080 yarn workspace @examples/users-service start:dev
curl localhost:8080/users
```

Сервис работает, и пора закрепить это тестами, которые не поднимают
сокет и не требуют базы. Следующая глава: [8. Убедиться, что работает,
без запуска сервера](./08-testing.md).
