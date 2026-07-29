## 1. Дискавери как значение (`@nestling/app`)

- [x] 1.1 Завести `packages/nestling.app/src/discovery.ts` с типами
      `DiscoveredEndpoint` (`endpoint`, `metadata`, `moduleName`) и
      `EndpointDiscovery` (`endpoints: DiscoveredEndpoint[]`,
      `transports: Map<string, DiscoveredEndpoint[]>`)
- [x] 1.2 Реализовать `discoverEndpoints(modules: readonly Module[]): EndpointDiscovery`:
      depth-first обход, `imports` до собственных `endpoints`, дедупликация
      модулей **по имени** (`Set<string>` — зеркало `ContainerBuilder.registerModule`),
      дедуп конструктора внутри модуля, детерминированный порядок
- [x] 1.3 Читать поле `endpoints` структурно (type guard по значению-модулю),
      а не по номинальному типу `AppModule`: модуль из `makeModule`
      с полем `endpoints` тоже обнаруживается
- [x] 1.4 Метаданные брать через `getEndpointMetadata()` (работает и для
      `@Endpoint`, и для `@HttpEndpoint` — общий `Symbol.for('nestling:handler')`);
      отсутствие метаданных — брошенная ошибка с именем класса и модуля
- [x] 1.5 Заполнять карту `transports` по `metadata.transport` в том же обходе
- [x] 1.6 Реализовать проверку «класс с метаданными эндпоинта объявлен в
      `providers`, но ни в одном `endpoints:`» — функция принимает дерево
      модулей и корневые `providers`, форму `ProvidersFactory` пропускает
- [x] 1.7 Экспортировать `discoverEndpoints` и типы из
      `packages/nestling.app/src/index.ts`

## 2. Тесты дискавери без контейнера

- [x] 2.1 `packages/nestling.app/src/discovery.spec.ts`: атрибуция —
      результат несёт `moduleName` объявителя (сценарий дельта-спека)
- [x] 2.2 Цикл `imports` (`A → B → A`): обход завершается, каждый эндпоинт
      ровно один раз
- [x] 2.3 Общий модуль, импортированный в двух ветках: одна регистрация
- [x] 2.4 Два разных объекта модуля с одним `name`: обходится только первый
      (совпадение с поведением контейнера)
- [x] 2.5 Детерминированный порядок: два вызова на одном дереве дают
      одинаковую последовательность; `imports` раньше собственных эндпоинтов
- [x] 2.6 Повтор одного класса внутри `endpoints:` одного модуля — одна запись
- [x] 2.7 Карта транспортов группирует ручки по `metadata.transport`
      (`http` ×2 + `cli` ×1)
- [x] 2.8 Класс в `endpoints:` без метаданных — брошенная ошибка с именем
      класса и модуля
- [x] 2.9 Класс с метаданными в `providers` мимо `endpoints:` — ошибка;
      та же конфигурация через `ProvidersFactory` — ошибки нет

## 3. Модуль-значение перестаёт терять `endpoints`

- [x] 3.1 `packages/nestling.app/src/module.ts`: `AppModule extends Module`
      с полем `endpoints?: Constructor<IEndpoint<any, any, any>>[]`
      (уходит нынешний `Omit<Module, 'providers'>` + ручной `providers?`)
- [x] 3.2 `makeAppModule(config: AppModule): AppModule` — возвращаемое
      значение сохраняет `endpoints` и по-прежнему дублирует их в `providers`
- [x] 3.3 Тест: возвращённое значение содержит и `endpoints`, и эндпоинты
      среди провайдеров; значение принимается `imports` и
      `ContainerBuilder.register`

## 4. `App` переезжает на дискавери

- [x] 4.1 `packages/nestling.app/src/app.ts`: убрать импорт `getAllEndpoints`;
      `#registerEndpoints()` работает от `discoverEndpoints(this.modules)`
- [x] 4.2 Проверку требуемых транспортов вынести перед регистрацией: ключи
      `discovery.transports`, которых нет в `this.transports`, — ошибка
      старта с именем транспорта, паттерном ручки и модулем-объявителем
- [x] 4.3 Сконфигурированный транспорт без обнаруженных ручек оставить
      легальным: `#listen()` по-прежнему поднимает все транспорты
- [x] 4.4 Прогнать проверку из 1.6 на дереве модулей + `config.providers`
      до регистрации (fail-fast с указанием модуля и подсказкой)
- [x] 4.5 Тексты ошибок «не резолвится контейнером» и «нет метаданных»
      дополнить модулем-объявителем; ветку `console.warn` + `continue`
      удалить
- [x] 4.6 Резолюцию классов-юнитов пайплайна (`metadata.pipeline?.bind(...)`)
      и порядок фаз `build → init → регистрация → listen` не трогать

## 5. Тесты `App`

- [x] 5.1 `packages/nestling.app/src/app.spec.ts`: убрать
      `clearEndpointRegistry()` из `beforeEach` и его импорт
- [x] 5.2 Переписать тест «endpoint в реестре, но не в контейнере» в
      «объявлен в `endpoints:`, но не резолвится»: ожидается ошибка,
      называющая класс и модуль
- [x] 5.3 Новый тест (ключевой баг-фикс): эндпоинт объявлен в модуле,
      который **не передан** в `App` → `app.run()` проходит, транспорт
      получил ноль регистраций
- [x] 5.4 Новый тест: эндпоинт с `transport: 'cli'` при
      `transports: { http }` → ошибка старта, называющая `cli`,
      паттерн и модуль
- [x] 5.5 Новый тест: транспорт передан, ручек на него нет → старт проходит,
      `listen()` вызван
- [x] 5.6 Новый тест: класс под `@HttpEndpoint` в `providers` мимо
      `endpoints:` → ошибка старта
- [x] 5.7 Проверить, что тесты не зависят от порядка исполнения (эндпоинты
      объявляются внутри `it()`, глобального состояния больше нет)
- [x] 5.8 `yarn test` в `packages/nestling.app` — зелёный

## 6. Удаление глобального реестра

- [x] 6.1 Удалить `packages/nestling.pipeline/src/metadata/endpoint-registry.ts`
- [x] 6.2 Убрать `export * from './endpoint-registry'` из
      `packages/nestling.pipeline/src/metadata/index.ts`
- [x] 6.3 `metadata/endpoint.ts`: убрать импорт и вызов `registerEndpoint`
      в декораторе `@Endpoint` (метаданные класса пишутся как прежде)
- [x] 6.4 `packages/nestling.transport.http/src/helpers.ts`: убрать импорт
      и вызов `registerEndpoint` в декораторе `@HttpEndpoint`
- [x] 6.5 Проверить: `grep -rn "registerEndpoint\|getAllEndpoints\|clearEndpointRegistry\|endpoint-registry" packages/ --exclude-dir=node_modules --exclude-dir=dist`
      даёт только метод `HttpTransport.registerEndpoint(instance, metadata)`
      (одноимённый публичный метод транспорта, к реестру отношения не имеет)
- [x] 6.6 `yarn test` в `packages/nestling.pipeline` и
      `packages/nestling.transport.http` — зелёные

## 7. Пример и гайды

- [x] 7.1 `packages/examples.app-with-http`: сверить, что все эндпоинты из
      `src/modules/users/endpoints/index.ts` перечислены в `endpoints:`
      `users.module.ts` (ожидается девять), недостающие — добавить
- [x] 7.2 Поднять пример вручную и проверить, что маршруты отвечают
      (`GET /api/users`, `GET /api/users/:id`, `POST /api/users`)
- [x] 7.3 `docs/guides/http-app-di.md`: зафиксировать, что класс под
      `@HttpEndpoint` обслуживается **только** будучи перечисленным в
      `endpoints:` модуля; обновить дату в плашке «сверено с кодом
      `examples.app-with-http`»
- [x] 7.4 Проверить `docs/guides/http-functional.md` и `docs/guides/cli.md`
      на упоминания автоматической регистрации по импорту — при находках
      привести к дискавери из дерева

## 8. README и документация репозитория

- [x] 8.1 `packages/nestling.app/README.md`: формулировка «auto-discovers
      `@Endpoint`-decorated classes from modules» уточняется до дискавери
      обходом дерева `modules` + `imports`; упомянуть `discoverEndpoints`
      в публичном API; проверить плашку статуса
- [x] 8.2 `packages/nestling.pipeline/README.md`: убрать реестр из описания
      публичного API (если упомянут), проверить плашку статуса
- [x] 8.3 `packages/nestling.transport.http/README.md`: проверить описание
      `@HttpEndpoint` на утверждение «регистрируется автоматически»
- [x] 8.4 Сверить `docs/design/container.md` и `docs/design/composition.md`
      с итогом: целевые формулировки уже описывают дискавери из дерева —
      правок не ожидается, расхождения фиксировать в спеке, а не молча в коде
- [x] 8.5 `docs/decisions/roadmap.md`: обновить статус change #8
      `endpoint-discovery`. Новую запись в `decisions/ideas.md` НЕ добавлять —
      решение зафиксировано секцией «[2026-07-08] Модульный монолит: фичи,
      `select`, дискавери из дерева модулей»
- [x] 8.6 Сверить итоговые правки кода с дельта-спеком
      `openspec/changes/endpoint-discovery/specs/endpoint-discovery/spec.md`;
      при расхождении править спек, а не молча код

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены
- [x] 9.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 9.5 `yarn docs:audit` — 0 ERROR
- [x] 9.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Коммиты осмысленные, ветка запушена
