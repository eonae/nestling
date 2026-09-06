## 1. Роли класса в контейнере

- [x] 1.1 Метаданные класса: роль рядом со списком зависимостей
      (`injectable.metadata.ts` → метаданные роли), чтение роли по классу
- [x] 1.2 `@Component([deps])`: тип, отвергающий класс с `handle` или со
      `static acquire` литералом `__error`; сверка длины и порядка с
      конструктором
- [x] 1.3 `@Handler([deps])`: тип, требующий метод `handle`; та же сверка с
      конструктором
- [x] 1.4 `@Resource([deps])`: тип, требующий `static acquire` и `release`;
      сверка списка с параметрами `acquire` без последнего
- [x] 1.5 `Family.auto` резолвится при декорировании всех трёх ролей
- [x] 1.6 `@Injectable` удалён из экспортов и из кода пакета
- [x] 1.7 `classProvider` принимает только компонент или ресурс; текст
      ошибки называет класс и предлагает `factoryProvider`
- [x] 1.8 Type-тесты ролей: три декоратора, запрещённые формы, длины
      списков
- [x] 1.9 Рантайм-тесты метаданных роли и `classProvider`

## 2. Ресурсы

- [x] 2.1 `resourceProvider(Token, { deps, acquire, release })` и его
      предикат в `variants.ts`
- [x] 2.2 Захват класса-ресурса: `await Class.acquire(...deps, signal)`
- [x] 2.3 Освобождение: `release` у класса и у определения
- [x] 2.4 Откат при провале захвата — обратный топологический порядок,
      исходная ошибка с приложенными ошибками `release`
- [x] 2.5 Рантайм-тесты: порядок захвата, откат, освобождение, повторное
      закрытие

## 3. Экземпляры на INIT

- [x] 3.1 `build()` строит граф из провайдеров: `DINode` несёт провайдер и
      пустой слот значения
- [x] 3.2 Циклы ловит `ensureAcyclic()` на графе провайдеров, с тем же
      путём в тексте ошибки
- [x] 3.3 Сверка роли с позицией на фазе ASSEMBLE: `providers:`,
      `transports:`, слот `handler:`
- [x] 3.4 `init(signal)` создаёт значения в топологическом порядке и
      собирает хуки `@OnStart` с экземпляров
- [x] 3.5 Аксессоры: ошибка фазы до INIT, `has(token)` для проверок сборки
- [x] 3.6 `@OnInit` и `@OnDestroy` удалены; `Hook` принимает `AbortSignal`;
      `destroy()` вызывает `release`
- [x] 3.7 Поле `defaults` у `Module` и его ветка в `build()` удалены;
      тесты `module-defaults` сняты
- [x] 3.8 Рантайм-тесты: пустой граф до INIT, идемпотентность `init()`,
      ошибка конструктора, обход графа до INIT
- [x] 3.9 Тесты подмен и прунинга (`overrides-pruning`, семейства,
      агрегаты) проходят без правок ожиданий, кроме момента создания

## 4. Фазы приложения

- [x] 4.1 `run()`: `AbortController` создаётся до `container.start(signal)`
- [x] 4.2 Опция `logger` у `makeApp` и в плане сборки: готовое значение
      `Logger`, провайдер под `RootLogger$` — ошибка дубля
- [x] 4.3 Корневой логгер создаётся на фазе 0 (опция или `ConsoleLogger`
      от снимка `nestlingLog`) и регистрируется
      `valueProvider(RootLogger$, root)`; ядро и читалка конфига пишут в
      него с фазы 0
- [x] 4.4 `ConsoleLogger` читает `requestId` из ambient-контекста
      напрямую, без зависимости от узла `Ctx(RequestId)`
- [x] 4.5 Тесты логгера: записи фаз 0–1 и RUN в одном логгере, подмена
      `[RootLogger$, spy]` в `overrides` тестового корня работает
- [x] 4.6 `#assertRequiredTransports` переходит на `container.has`
- [x] 4.7 `#assertFormsSupported` читает способности из объявлений
      `transports:`
- [x] 4.8 `close()`: `release` вместо `@OnDestroy`, порядок шагов прежний
- [x] 4.9 `check()` не создаёт экземпляров — тест с конструктором,
      пишущим в файл
- [x] 4.10 Тестовый корень (`assembleTest`, `[TEST_SEAM]`) проходит те же
      фазы; `stub` и подмены не сломаны

## 5. Транспорты

- [x] 5.1 `capabilities` — поле `TransportDeclaration`; поле у `ITransport`
      удалено
- [x] 5.2 `http()`, `cli()`, шина и `transportValue` кладут константу
      способностей в объявление; `serve` читает ту же константу
- [x] 5.3 `transport.nats`: `@OnInit` подключения к брокеру → ресурс
- [x] 5.4 Фикстуры транспортов в тестах (`__fixtures__`, `MockTransport`)
      переведены на объявления со способностями

## 6. Пакеты поверх ядра

- [x] 6.1 `@nestling/openapi`: классы на `@Component`/`@Handler`
- [x] 6.2 `@nestling/subscriptions`: слои на `@Component`, реестр с
      `@OnDestroy` → ресурс с `release`
- [x] 6.3 `@nestling/testing`: `assembleTest`, `stub`, фикстуры и
      документация методов
- [x] 6.4 `@nestling/app`: kernel-модули (логгер, конфиг, порты, контекст)
      на новые декораторы

## 7. Примеры

- [x] 7.1 `examples/users-service`: `database.ts` — ресурс, поле без
      `| undefined`
- [x] 7.2 `examples/app-with-http`: то же для `features/users/database.ts`
- [x] 7.3 Прочие примеры: `@Injectable` → `@Component`/`@Handler`

## 8. Документация

- [x] 8.1 `docs/design/container.md`: роли, ресурсы, создание на INIT
- [x] 8.2 `docs/design/composition.md` и `docs/design/transports.md`: фазы,
      способности в объявлении
- [x] 8.3 `docs/design/principles.md`: формулировка «жадный контейнер»
- [x] 8.4 `docs/glossary.md` и `docs/conventions.md`: термины «компонент»,
      «ресурс», «хендлер»
- [x] 8.5 README пакетов `container`, `app`, `openapi`, `subscriptions`,
      `testing` — включая плашки статуса и раздел про логгер корня
- [x] 8.6 Глава 5 гайда переписана вокруг ресурса `Database`, глава 8 —
      вокруг опции `logger` корня
- [ ] 8.7 Главы 4, 6–14, 16, 17, 19, 21–25 и приложения А, Б пересверены с
      кодом; дата в плашке «сверено с кодом» обновлена

## 9. Definition of Done

- [ ] 9.1 Все задачи выше отмечены
- [x] 9.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
      `type-budget` по всем пакетам)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам
      `CLAUDE.md`
- [ ] 9.5 `yarn docs:audit` — 0 ERROR
- [ ] 9.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Коммиты осмысленные, ветка `change/resources-and-roles` запушена
