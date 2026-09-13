# modular-app

Приложение из двух фич: `users` принимает регистрации, `notifications`
шлёт письма. Одна декларация поднимается и одним процессом, и двумя — в
коде фич при этом не меняется ничего.

Рассылка вынесена не ради примера: она медленная, ретраится и
масштабируется отдельно от приёма регистраций.

## Что показывает

| Тема | Где смотреть |
|---|---|
| Операции между фичами: запрос, событие, команда | [`src/operations.ts`](./src/operations.ts) |
| Одна декларация на все процессы, `intercom` и шина NATS | [`src/app.ts`](./src/app.ts) |
| Выбор фич процесса и `includeDeps` | [`src/main.ts`](./src/main.ts) |
| Переключатель состава: чем отправлять письма | [`src/switches.ts`](./src/switches.ts), [`src/features/notifications/notifications.feature.ts`](./src/features/notifications/notifications.feature.ts) |
| Транзакционный emit: событие уходит после коммита | [`src/features/users/register-user.endpoint.ts`](./src/features/users/register-user.endpoint.ts) |
| Транзакционный приём: повтор не доходит до хендлера | [`src/features/notifications/welcome-email.endpoint.ts`](./src/features/notifications/welcome-email.endpoint.ts) |
| Повтор при отказе почты и порт отправки | [`src/features/notifications/mailer.ts`](./src/features/notifications/mailer.ts) |
| Ключ идемпотентности у команды | [`src/features/notifications/forget-address.endpoint.ts`](./src/features/notifications/forget-address.endpoint.ts) |
| Трасса и арендатор через границу процесса | [`src/base.ts`](./src/base.ts), [`src/context.ts`](./src/context.ts) |
| Снимок операций и сверка совместимости | [`src/compat.ts`](./src/compat.ts), [`operations.snapshot.json`](./operations.snapshot.json) |
| Изоляция фичи стабами операций | [`src/isolated.spec.ts`](./src/isolated.spec.ts) |
| Два процесса на двойнике брокера | [`src/split.spec.ts`](./src/split.spec.ts) |

## Как поднять

Обоими профилями сразу из Docker:

```bash
# Один процесс со всеми фичами
docker compose --profile mono up

# Те же фичи по процессу на каждую
docker compose --profile split up
```

Профили делят одни объявления PostgreSQL и NATS: второй копии сервисов
инфраструктуры нет.

Локально, с инфраструктурой в Docker и приложением в своём процессе:

```bash
cp .env.example .env
yarn workspace @examples/modular-app db:up        # PostgreSQL и NATS
yarn workspace @examples/modular-app db:migrate   # миграции drizzle
yarn workspace @examples/modular-app start:dev
```

`APP_FEATURES=users` и `APP_FEATURES=notifications` поднимают половины
приложения в разных процессах, `APP_FEATURES=all` — обе в одном.

## Что потрогать

```bash
# Кладём команду на шину внешним клиентом
yarn workspace @examples/modular-app publish:command carol@example.com

# Тот же адрес просим забыть
yarn workspace @examples/modular-app publish:command carol@example.com --forget

# Пробы и метрики процесса
curl localhost:3100/healthz
curl localhost:3100/metrics
```

Сверка совместимости операций — то, что делал бы CI на pull request'е:

```bash
yarn workspace @examples/modular-app compat
```

Снимок перезаписывается осознанно: `UPDATE_SNAPSHOT=1 … compat`.

Граф зависимостей в браузере (нужна поднятая база):

```bash
yarn workspace @examples/modular-app visualize
```

## Конфигурация

Ключи и умолчания перечислены в [`.env.example`](./.env.example).
Обязательных ключей нет: `DATABASE_URL` и `NATS_SERVERS` имеют умолчания
для локального прогона.

`APP_MAIL=smtp` переключает адаптер отправки. Ветка `smtp` в примере
отказывает всегда — так видно повтор и то, как отказ доходит до отката
транзакции подписчика.

## Тесты

`yarn workspace @examples/modular-app test`. Спеки, которым нужна
настоящая база, читают `MODULAR_TEST_DATABASE_URL`; без неё они
пропускаются, и проверка на машине без базы остаётся зелёной. Имя
переменной своё: у этого приложения своя база, потому что таблица
пользователей есть и у [`microservice`](../microservice/). Брокер в тестах
ненастоящий: `split.spec.ts` поднимает два процесса на двойнике NATS.
