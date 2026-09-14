# microservice

Сервис, который отвечает внешним клиентам. Одна фича, `users`, и всё, что
нужно такому сервису в проде: база с миграциями, проверка Bearer-токена,
наблюдаемость, файлы и потоки, документ API, инструменты агента, метрики
и пробы.

## Что показывает

| Тема | Где смотреть |
|---|---|
| Декларация приложения: плагины, транспорты, политики | [`src/app.ts`](./src/app.ts) |
| Операции API: одно объявление на сервер и клиент | [`src/api/operations.ts`](./src/api/operations.ts) |
| Типизированный клиент из тех же операций | [`src/api/client.ts`](./src/api/client.ts) |
| PostgreSQL: соединение, транзакция запроса, хранилища | [`src/persistence.ts`](./src/persistence.ts) |
| Схема и миграции drizzle | [`src/schema.ts`](./src/schema.ts), [`drizzle/`](./drizzle) |
| Проверка Bearer-токена слоем пайплайна | [`src/auth.ts`](./src/auth.ts) |
| Идентификатор запроса, трасса и строка аудита | [`src/observability.ts`](./src/observability.ts) |
| Загрузка файла и выгрузка потоком NDJSON | [`src/users/endpoints/`](./src/users/endpoints) |
| Живая лента по SSE и реестр подписок | [`src/users/activity.hub.ts`](./src/users/activity.hub.ts), [`src/ops/`](./src/ops) |
| Инструменты агента по MCP на том же сокете | [`src/users/tools/`](./src/users/tools) |
| Webhook с проверкой HMAC-подписи | [`src/users/endpoints/user-webhook.endpoint.ts`](./src/users/endpoints/user-webhook.endpoint.ts) |
| Метрики группой и экспозиция пакетом | [`src/users/users.metrics.ts`](./src/users/users.metrics.ts), [`src/app.ts`](./src/app.ts) |
| Пробы `/healthz` и `/readyz`, версия сборки | [`src/ops/ops.plugin.ts`](./src/ops/ops.plugin.ts) |

## Как поднять

```bash
cp .env.example .env
yarn workspace @examples/microservice db:up        # PostgreSQL в docker
yarn workspace @examples/microservice db:migrate   # миграции drizzle
yarn workspace @examples/microservice start:dev
```

Сервис слушает `HTTP_PORT` — по умолчанию 3000. На том же сокете и
HTTP-endpoint'ы, и сообщения MCP по `POST /mcp`.

Остановить базу и удалить её том: `… db:down`.

## Что потрогать

```bash
# Список и один пользователь
curl localhost:3000/users
curl localhost:3000/users/<id>

# Создание: меняющий запрос предъявляет Bearer-токен
curl -X POST localhost:3000/users \
  -H 'authorization: Bearer dev-token' \
  -H 'content-type: application/json' \
  -d '{"name":"Carol","email":"carol@example.com"}'

# `?dryRun=true` проверяет данные, не записывая
curl -X POST 'localhost:3000/users?dryRun=true' \
  -H 'authorization: Bearer dev-token' \
  -H 'content-type: application/json' \
  -d '{"name":"Dry","email":"dry@example.com"}'

# Живая лента: откройте в одном терминале и создайте пользователя в другом
curl -N localhost:3000/users/activity

# Активные подписки этого процесса
curl localhost:3000/ops/subscriptions

# Документ OpenAPI, метрики, пробы, версия сборки
curl localhost:3000/openapi.json
curl localhost:3000/metrics
curl localhost:3000/healthz
curl localhost:3000/ops/version
```

Типизированный клиент из тех же операций:
`API_TOKEN=dev-token yarn workspace @examples/microservice client`.

Документ OpenAPI в файл, без поднятия сервиса:
`yarn workspace @examples/microservice openapi`. Аргументом можно
задать состав: `… openapi docs=off`.

## Конфигурация

Ключи и умолчания перечислены в [`.env.example`](./.env.example).
Обязательны два: `API_TOKEN` и `WEBHOOK_SECRET` — без них сервис не
стартует. Остальные имеют умолчания.

Состав процесса конфигурация не задаёт: его задаёт аргумент сборки.
Флаг `--docs off` убирает документ OpenAPI из сборки целиком — не прячет
endpoint, а не создаёт его; `--help` печатает схему аргументов.

## Тесты

`yarn workspace @examples/microservice test` — спеки рядом с кодом. Те,
которым нужна настоящая база, читают `TEST_DATABASE_URL`; без неё они
пропускаются, и проверка на машине без базы остаётся зелёной.

`yarn workspace @examples/microservice test:e2e` — прогон через сокет:
приложение поднимается на эфемерном порту, тесты ходят в него `fetch`'ем.
Базу они засевают сами и тоже гейтятся `TEST_DATABASE_URL`. В `yarn
verify` этот прогон не входит.
