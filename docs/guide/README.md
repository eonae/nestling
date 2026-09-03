# Гайд по Nestling

Гайд ведёт от первого сервиса к приложению из нескольких фич,
развёрнутому в нескольких процессах. Каждая глава начинается с задачи,
которую вы и так собираетесь решать, и раскрывает ровно те возможности
фреймворка, без которых задача не решается. Возможности, которые задаче
пока не нужны, глава называет в разделе «Пока не нужно» и отсылает к
главе, где они появятся.

Читатель гайда знает TypeScript и писал сервисы на Nest или Express.
Термины берутся из [глоссария](../glossary.md). Целевое описание каждой
подсистемы лежит в [`design/`](../design/README.md), причины решений в
[`decisions/ideas.md`](../decisions/ideas.md); главы ссылаются на них в
плашке.

## Как читать

Части 1 и 2 читайте подряд: они собирают один сервис, и каждая глава
опирается на код предыдущей. Часть 3 нужна, когда областей в приложении
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
| [1. Поднять сервис, который отвечает на запрос](./01-first-service.md) | endpoint, фича, `assemble`, транспорт `http()` | `examples.users-service` |
| [2. Принять данные и не пропустить мусор](./02-input.md) | схема `input`, path и query, ответ `400` | `examples.users-service` |
| [3. Сказать клиенту, что пошло не так](./03-errors.md) | `defineFail`, `errors:`, `Ok.created`, незадекларированные ошибки | `examples.users-service` |
| [4. Хендлеру нужен репозиторий](./04-repository.md) | `deps`, `@Injectable`, токен интерфейса, `@OnInit` | `examples.users-service` |
| [5. Порт и адрес базы из окружения](./05-config.md) | `makeConfig`, ключи, `secret`, fail-fast | `examples.users-service` |
| [6. Убедиться, что работает, без запуска сервера](./06-testing.md) | `assembleTest`, `overrides`, `vars`, юнит-тест хендлера | `examples.users-service` |

## Часть 2. Сервис в проде

| Глава | Задача | Пример |
|---|---|---|
| [7. Видеть каждый запрос в логе](./07-logging.md) | пайплайн `.pre` и `.finally`, слой, `compose`, `Ctx(RequestId)` | `examples.users-service` |
| [8. Пускать только своих](./08-auth.md) | pre-юнит с отказом, контекст слоя, политики, `detached` | `examples.users-service` |
| [9. Файлы и большие выгрузки](./09-files-and-streams.md) | `multipart`, `upload`, `stream(T)` на входе и выходе | `examples.users-service` |
| [10. Отдать фронтенду документацию и клиент](./10-openapi-and-client.md) | `openapi()`, `doc:`, операция с `http:`, `makeClient` | `examples.users-service` |

## Часть 3. Приложение растёт

| Глава | Задача | Пример |
|---|---|---|
| [11. Выделить вторую область](./11-features.md) | граница фич, операция `request`, `implement`, `.caller`, плагины, модули | `examples.app-with-http` |
| [12. Оповещать соседей о случившемся](./12-events.md) | `event`, `command`, `subscriber`, ключ идемпотентности | `examples.app-with-http` |
| [13. Живая лента для клиента](./13-live-feed.md) | `events(T)`, `sse:`, `Topic`, `AbortSignal` | `examples.app-with-http` |
| [14. Тестировать фичу без соседей](./14-testing-features.md) | `stubs`, `app.emit`, `contextValue`, `checkTopologies` | `examples.app-with-http`, `examples.split-nats` |

## Часть 4. Разворачивать по частям

| Глава | Задача | Пример |
|---|---|---|
| [15. Запускать только часть фич](./15-select.md) | `select`, `includeDeps`, `load()` до сборки, `check()` | `examples.app-with-http` |
| [16. Разнести фичи по процессам](./16-split.md) | `nats()`, `intercom`, `durable`, `propagate` | `examples.split-nats` |
| [17. Не сломать соседей при изменении операции](./17-compatibility.md) | версия в имени, снапшот операций, `diffOperations` | `examples.app-with-http` |

## Часть 5. Редкие задачи

| Глава | Задача | Пример |
|---|---|---|
| [18. Webhook с проверкой подписи](./18-webhook.md) | `rawBody`, требование слоя к стартовому контексту | `examples.app-with-http` |
| [19. CLI-утилита на тех же примитивах](./19-cli.md) | `cliEndpoint`, `cli()`, argv и REPL, поток из stdin | `examples.simple-cli` |
| [20. Логгер с именем потребителя и сбор вкладов](./20-token-families.md) | семейства токенов, `.auto`, `.all`, `familyProvider` | `examples.container` |
| [21. Конфиг из файла и без перезапуска](./21-config-sources.md) | источники и привязка, `.keys`, общие ключи, `reloadable` | `examples.container` |
| [22. Кто сейчас подключён и как его отключить](./22-ops.md) | реестр подписок, `tracked`, административные endpoint'ы | `examples.app-with-http` |
| [23. Без `assemble`](./23-standalone.md) | `makeDispatch`, `serve`, `ContainerBuilder` | `examples.simple-http-server`, `examples.container` |
| [24. Расширить ядро своим пакетом](./24-extending.md) | граница ядра, satellite, subpath `./testing` | `@nestling/subscriptions` |

## Приложения

| Приложение | О чём |
|---|---|
| [А. Альтернативные формы](./appendix-a-alternatives.md) | класс-хендлер, `throw` и `meta.fail`, `.ok` и `.catch`, `body()` |
| [Б. Из NestJS](./appendix-b-from-nestjs.md) | чему соответствуют понятия Nest |
| [В. Карта понятий](./appendix-c-coverage.md) | понятие, глава, файл примера |
