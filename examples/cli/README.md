# cli

Инструмент командной строки к сервису из
[`examples/microservice`](../microservice/). Команды вызывают его
операции типизированным клиентом: копии деклараций здесь нет.

## Что показывает

| Тема | Где смотреть |
|---|---|
| Запуск по аргументам и REPL | [`src/main.ts`](./src/main.ts) |
| Клиент из операций сервиса | [`src/api.ts`](./src/api.ts) |
| Вопросы команды выводятся из схемы входа | [`src/commands/create-user.command.ts`](./src/commands/create-user.command.ts) |
| Поток на выходе команды | [`src/commands/export-users.command.ts`](./src/commands/export-users.command.ts) |
| Поток stdin на входе команды | [`src/commands/import-users.command.ts`](./src/commands/import-users.command.ts) |
| Отказ сервиса своим кодом в командной строке | [`src/commands.spec.ts`](./src/commands.spec.ts) |

## Как поднять

Сначала сервис — см. [его README](../microservice/README.md). Затем:

```bash
export API_URL=http://localhost:3000
export API_TOKEN=dev-token

yarn workspace @examples/cli start:dev help
```

Без аргументов открывается REPL:

```bash
yarn workspace @examples/cli start:dev
```

## Что потрогать

```bash
# Недостающие поля команда спрашивает в терминале
yarn workspace @examples/cli start:dev create-user

# Те же поля опциями: спрашивать нечего
yarn workspace @examples/cli start:dev \
  create-user --name Carol --email carol@example.com

# `--check` проверяет данные, не создавая пользователя
yarn workspace @examples/cli start:dev \
  create-user --name Dry --email dry@example.com --check

# Список; число из опции делает схема команды
yarn workspace @examples/cli start:dev list-users --limit 5

# Выгрузка печатается по мере готовности
yarn workspace @examples/cli start:dev export-users

# Импорт читает NDJSON из stdin
yarn workspace @examples/cli start:dev export-users \
  | yarn workspace @examples/cli start:dev import-users
```

## Конфигурация

| Переменная | Что задаёт |
|---|---|
| `API_URL` | адрес сервиса; по умолчанию `http://localhost:3000` |
| `API_TOKEN` | Bearer-токен для команд, меняющих данные |

## Тесты

`yarn workspace @examples/cli test`. Сервис в них не поднимается: `fetch`
подменяется на время прогона, и проверяется то, за что отвечает CLI, —
разбор аргументов, вопросы недостающего и разбор ответа сервиса.
