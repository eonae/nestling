# 7. Порт и адрес базы из окружения

> Гайд по текущему API; сверено с кодом `users-service` (2026-09-12).
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
import { from, makeConfig, secret } from '@nestlingjs/app';
import { z } from 'zod';

export const AppConfig = makeConfig('app', {
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .describe('Размер страницы списка пользователей'),
  apiToken: secret(
    from(
      'API_TOKEN',
      z.string().min(1).describe('Bearer-токен для запросов, меняющих данные'),
    ),
  ),
});
```

Адреса базы здесь нет, и это не пропуск. Секцию соединения объявляет
пакет `@nestlingjs/drizzle.pg`, а приложение получает от него только
право привязать источник к его ключам. Так же устроены порт и хост
HTTP-сервера: их читает сервер, а не приложение.

Секция — объект с префиксом, где каждому полю соответствует схема. Имя
переменной выводится из префикса и имени поля, `from('NAME', schema)`
задаёт точное имя.

Описание поля пишется средствами схемы: `.describe()` у zod. Фреймворк
его не читает — оно нужно человеку, который открыл файл, и тому, кто
переносит таблицу переменных в документацию по развёртыванию.

| Переменная | Поле | Что задаёт | По умолчанию |
|---|---|---|---|
| `APP_PAGE_SIZE` | `pageSize` | размер страницы списка пользователей | `20` |
| `DATABASE_URL` | секция соединения | адрес базы данных | нет, переменная обязательна |
| `DATABASE_POOL_MAX` | секция соединения | размер пула соединений | `10` |
| `API_TOKEN` | `apiToken` | Bearer-токен для запросов, меняющих данные | нет, переменная обязательна |
| `HTTP_PORT` | секция сервера | порт HTTP-сервера | `3000` |
| `HTTP_HOST` | секция сервера | адрес прослушивания | `0.0.0.0` |

Значения окружения приходят строками. Число из строки делает схема,
поэтому у `pageSize` стоит `z.coerce.number()`.

## Вычисляемое поле

Третий аргумент `makeConfig` объявляет поля, значения которых считаются
из других полей той же секции. Так устроена секция соединения в
`@nestlingjs/drizzle.pg`: хост считается из адреса, поэтому разбирать URL
в каждом потребителе не нужно.

```typescript
// packages/nestling.drizzle.pg/src/config.ts
export const DatabaseConfig = makeConfig.family(
  'database',
  {
    url: secret(str()),
    poolMax: int(10, 1),
    // …
  },
  (derived) => ({
    host: derived(['url'], (url) => new URL(String(url)).host),
  }),
);
```

`derived(deps, fn)` называет зависимости именами полей первого рекорда, а
`fn` получает их значения по порядку. Компилятор проверяет и имена, и
типы: `'urll'` не соберётся, и аннотация `(url: number)` тоже. Переменной
окружения у поля нет — в таблице выше его нет, и в `.keys` секции оно не
входит. Значение считается один раз, при валидации секции.

`url` помечен `secret()`, поэтому `host` тоже секретен: поле наследует
секретность своих зависимостей. Правило одностороннее и намеренно
грубое — снять пометку нечем.

`makeConfig.family` вместо `makeConfig` — потому что соединений в
процессе может быть несколько, и у каждого свой адрес. Имя экземпляра
вставляется в ключи: `DATABASE_ANALYTICS_URL` у экземпляра `analytics`.
Тем же способом получает свои ключи второй HTTP-сервер.

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

Так же секцию читает любой другой потребитель — компонент, ресурс или
фабрика: DI-токен секции стоит в списке зависимостей, и контейнер
подставляет проверенное значение.

```bash
API_TOKEN=secret APP_PAGE_SIZE=1 yarn workspace @examples/users-service start:dev
curl 'localhost:3000/users'
```

## Секреты

`secret()` помечает поле, значение которого не должно попадать в вывод.
Для потребителя ничего не меняется: `config.apiToken` возвращает
настоящую строку. Меняется то, что печатает фреймворк. `console.log` и
`JSON.stringify` секции показывают `'***'` вместо значения, а ошибка
валидации заменяет сообщение валидатора на `<redacted>`.

За свои строки отвечает потребитель: соединение пишет в лог подключения
только хост, а не адрес целиком. Хост унаследовал секретность от адреса,
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
сокет. Следующая глава: [8. Убедиться, что работает, без запуска
сервера](./08-testing.md).
