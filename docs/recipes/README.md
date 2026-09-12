# Рецепты

Рецепт решает одну задачу и читается отдельно от остальных. Порядка
чтения у списка нет: номера у рецепта нет, а имя файла называет задачу.
Понятия, которые рецепт использует, вводит [гайд](../guide/README.md) —
рецепт на них ссылается, а не повторяет их.

| Рецепт | Задача | Пример |
|---|---|---|
| [Webhook с проверкой подписи](./webhook.md) | `rawBody`, требование слоя к стартовому контексту | `app-with-http` |
| [CLI-утилита на тех же примитивах](./cli.md) | `cliEndpoint`, `cli()`, argv и REPL, поток из stdin | `simple-cli` |
| [Зависимости по имени и сбор вкладов из модулей](./token-families.md) | семейства DI-токенов, `familyProvider`, `.auto` на `Logger$`, `.all` | `container` |
| [Конфиг из файла и без перезапуска](./config-sources.md) | источники и привязка, `.keys`, общие ключи, `reloadable` | `container` |
| [Кто сейчас подключён и как его отключить](./ops.md) | реестр подписок, `tracked`, административные endpoint'ы | `app-with-http` |
| [Без `makeApp`](./standalone.md) | `makeDispatch`, `serve`, `ContainerBuilder` | `simple-http-server`, `container` |
| [Расширить ядро своим пакетом](./extending.md) | граница ядра, сателлит, subpath `./testing` | `nestling.subscriptions` |
| [Альтернативные формы](./alternatives.md) | функция с `deps`, отказ броском, `.ok` и `.catch` | `app-with-http` |
