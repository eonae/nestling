## 1. Контейнер: синхронная сборка

- [x] 1.1 `ContainerBuilder.build()` возвращает `BuiltContainer`: `await` снят с `appendFactoryProviders`, `instantiateAll` и `createInstance`
- [x] 1.2 `createInstance` бросает ошибку с DI-токеном провайдера, если `useFactory` вернула thenable; текст называет место захвата внешнего мира
- [x] 1.3 `appendFactoryProviders` бросает ошибку с именем модуля, если фабрика `providers` вернула thenable
- [x] 1.4 Типы запрещают `Promise`: `FactoryProviderDefinition`, `FactoryProviderWithDeps`, возвращаемый тип `factoryProvider()`, `ProvidersFactory`
- [x] 1.5 `BuiltContainer.forEachNode(callback)` — синхронный перебор узлов; JSDoc отличает его от `traverse`
- [x] 1.6 Спеки контейнера: синхронный `build()`, обе ошибки на thenable, `forEachNode`; type-test на хелпер `factoryProvider`
- [x] 1.7 Вызовы `await builder.build()` во всех пакетах и спеках репозитория переписаны

## 2. Конфиг: фаза 0 и снимок

- [x] 2.1 `ConfigReader.init()` читает ключи реестра в снимок; `read(key)` отдаёт значение из снимка
- [x] 2.2 Ключ вне реестра читается через `get()` инициализированных источников и попадает в снимок
- [x] 2.3 Отказ `init()` источника — ошибка фазы 0 с именем источника и исходной ошибкой в `cause`; `init()` зовётся один раз
- [x] 2.4 `#refreshAll()` перечитывает ключи reloadable-секций в снимок перед перепроекцией
- [x] 2.5 `@OnDestroy` снят с `ConfigReader.close()`
- [x] 2.6 `bootstrapConfig(bindings, options)` поднимает источники вне контейнера; `configKernel(bootstrap)` регистрирует читалку `valueProvider`'ом под тем же приватным токеном
- [x] 2.7 Спеки конфига: снимок, чтение по промаху, ошибка фазы 0, отсутствие повторного опроса источников на сборке

## 3. Приложение: фазы 0 и 1

- [x] 3.1 `AssembledApp` получает шаг `#bootstrap()`; `#assemble()` синхронный и без единого `await`
- [x] 3.2 `assertFeatureBoundary` синхронна и ходит по графу через `forEachNode`
- [x] 3.3 `close()` закрывает читалку после `container.destroy()`; шов проверки закрывает её сразу после формирования отчёта
- [x] 3.4 `CheckOptions.config` принимает три формы; `ConfigInput` и `toBindings` живут в `@nestling/app`
- [x] 3.5 Спеки `@nestling/app`: порядок фаз, `check()` с `vars({ … })` без источников, закрытие источников на shutdown и после проверки

## 4. Тестирование

- [x] 4.1 `@nestling/testing` использует `ConfigInput` и `toBindings` из `@nestling/app`; `TestConfig` удалён
- [x] 4.2 `checkTopologies` прокидывает `config` в каждую топологию
- [x] 4.3 Спеки `@nestling/testing` обновлены

## 5. Пример и документация

- [x] 5.1 `examples/container` собирается без `await builder.build()` и поднимает конфиг явной фазой 0
- [x] 5.2 `docs/design/composition.md`: фаза 0 поднимает источники и закрывает их на SHUTDOWN, повторы объявляет источник
- [x] 5.3 `docs/design/config.md` и `docs/design/container.md` сверены с реализацией (снимок, время жизни читалки, синхронная фабрика)
- [x] 5.4 README пакетов `nestling.container`, `nestling.app`, `nestling.testing` обновлены, включая плашки статуса
- [x] 5.5 Главы гайда 06, 07, 22, 24 пересверены с кодом, дата в плашке «сверено с кодом» поднята
- [x] 5.6 `node .claude/skills/docs-style/scripts/lint.mjs` по изменённым текстам — 0 запрещённых слов

## 6. Definition of Done

- [x] 6.1 Все задачи выше отмечены
- [x] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` + `type-budget` по всем пакетам плюс smoke)
- [x] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 6.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 6.5 `yarn docs:audit` — 0 ERROR
- [x] 6.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с обновлённой датой в плашке «сверено с кодом»
- [ ] 6.7 Коммиты осмысленные, ветка `change/sync-assemble` запушена
