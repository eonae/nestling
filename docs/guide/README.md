# Гайд по Nestling

Гайд ведёт от первого сервиса к приложению из нескольких фич,
развёрнутому в нескольких процессах. Каждая глава начинается с задачи,
которую вы и так собираетесь решать, и раскрывает ровно те возможности
фреймворка, без которых задача не решается. Возможности, которые задаче
пока не нужны, глава не называет вовсе: понятие появляется там, где его
объясняют, а не раньше.

Читатель гайда знает TypeScript и писал сервисы на Nest или Express.
Термины берутся из [глоссария](../glossary.md). Целевое описание каждой
подсистемы лежит в [`design/`](../design/README.md), причины решений в
[`decisions/ideas.md`](../decisions/ideas.md); главы ссылаются на них в
плашке.

## Как читать

Части 1 и 2 читайте подряд: они собирают один сервис, и каждая глава
опирается на код предыдущей. Правила именования, которым следуют
примеры, собраны в [conventions.md](../conventions.md). Часть 3 нужна, когда областей в приложении
становится больше одной. Часть 4 нужна, когда одного процесса мало.
Часть 5 читается по потребности: каждая её глава самостоятельна.

Код всех глав лежит в `packages/examples.*`. Части 1 и 2 собирают
`examples.users-service`, части 3 и 4 продолжают его в
`examples.app-with-http` и `examples.split-nats`. Сниппет в главе
начинается с пути к файлу примера и совпадает с ним. Сниппет, который
показывает промежуточный шаг, помечен комментарием «шаг главы»; итоговая
версия файла названа рядом.

## Часть 1. Первый сервис

| Глава | Задача | Пример |
|---|---|---|
| [1. Поднять сервис, который отвечает на запрос](./01-first-service.md) | endpoint, фича, `makeApp`, транспорт `http()` | `examples.users-service` |
| [2. Принять данные и не пропустить мусор](./02-input.md) | схема `input`, path и query, `bind`, ответ `400` | `examples.users-service` |
| [3. Сказать клиенту, что пошло не так](./03-errors.md) | `makeFail`, код с категорией, `errors:`, `Ok.created` | `examples.users-service` |
| [4. Хендлер как класс](./04-handler-class.md) | поле `handler`, `@Injectable`, юнит-тест через `new` | `examples.users-service` |
| [5. Откуда хендлер берёт репозиторий](./05-repository.md) | токен интерфейса, `providers`, `@OnInit`, значения-провайдеры | `examples.users-service` |
| [6. Порт и адрес базы из окружения](./06-config.md) | `makeConfig`, ключи, `secret`, fail-fast | `examples.users-service` |
| [7. Убедиться, что работает, без запуска сервера](./07-testing.md) | `assembleTest(app, …)`, `overrides`, `vars`, юнит-тест хендлера | `examples.users-service` |

## Часть 2. Сервис в проде

| Глава | Задача | Пример |
|---|---|---|
| [8. Видеть каждый запрос в логе](./08-logging.md) | пайплайн `.pre` и `.finally`, слой, `compose`, `Ctx(RequestId)` | `examples.users-service` |
| [9. Пускать только своих](./09-auth.md) | pre-юнит с отказом, контекст слоя, политики, `detached` | `examples.users-service` |
| [10. Файлы и большие выгрузки](./10-files-and-streams.md) | `multipart`, `upload`, `stream(T)` на входе и выходе | `examples.users-service` |
| [11. Отдать фронтенду документацию и клиент](./11-openapi-and-client.md) | `openapi()`, `doc:`, операция с `http:`, `makeClient` | `examples.users-service` |

## Часть 3. Приложение растёт

| Глава | Задача | Пример |
|---|---|---|
| [12. Выделить вторую область](./12-features.md) | граница фич, операция `request`, `implement`, `.caller`, плагины, модули | `examples.app-with-http` |
| [13. Оповещать соседей о случившемся](./13-events.md) | `event`, `command`, `subscriber`, ключ идемпотентности | `examples.app-with-http` |
| [14. Живая лента для клиента](./14-live-feed.md) | `events(T)`, `sse:`, `Topic`, `AbortSignal` | `examples.app-with-http` |
| [15. Тестировать фичу без соседей](./15-testing-features.md) | `stubs`, `testApp.emit`, `contextValue`, `checkTopologies` | `examples.app-with-http`, `examples.split-nats` |

## Часть 4. Разворачивать по частям

| Глава | Задача | Пример |
|---|---|---|
| [16. Запускать только часть фич](./16-select.md) | `assemble(select)`, `includeDeps`, `load()` до сборки, `check()` | `examples.app-with-http` |
| [17. Разнести фичи по процессам](./17-split.md) | `nats()`, `intercom`, `durable`, `propagate` | `examples.split-nats` |
| [18. Не сломать соседей при изменении операции](./18-compatibility.md) | версия в имени, снапшот операций, `diffOperations` | `examples.app-with-http` |

## Часть 5. Редкие задачи

| Глава | Задача | Пример |
|---|---|---|
| [19. Webhook с проверкой подписи](./19-webhook.md) | `rawBody`, требование слоя к стартовому контексту | `examples.app-with-http` |
| [20. CLI-утилита на тех же примитивах](./20-cli.md) | `cliEndpoint`, `cli()`, argv и REPL, поток из stdin | `examples.simple-cli` |
| [21. Логгер с именем потребителя и сбор вкладов](./21-token-families.md) | семейства токенов, `.auto`, `.all`, `familyProvider` | `examples.container` |
| [22. Конфиг из файла и без перезапуска](./22-config-sources.md) | источники и привязка, `.keys`, общие ключи, `reloadable` | `examples.container` |
| [23. Кто сейчас подключён и как его отключить](./23-ops.md) | реестр подписок, `tracked`, административные endpoint'ы | `examples.app-with-http` |
| [24. Без `makeApp`](./24-standalone.md) | `makeDispatch`, `serve`, `ContainerBuilder` | `examples.simple-http-server`, `examples.container` |
| [25. Расширить ядро своим пакетом](./25-extending.md) | граница ядра, satellite, subpath `./testing` | `@nestling/subscriptions` |

## Приложения

| Приложение | О чём |
|---|---|
| [А. Альтернативные формы](./appendix-a-alternatives.md) | функция с `deps`, отказ броском, `.ok` и `.catch` |
| [Б. Из NestJS](./appendix-b-from-nestjs.md) | чему соответствуют понятия Nest |
| [В. Карта понятий](./appendix-c-coverage.md) | понятие, глава, файл примера |
