# token-families — tasks

## 1. Семейства токенов: makeTokenFamily (nestling.container)

- [x] 1.1 Тип `TokenFamily<T>` и `makeTokenFamily<T, Params extends [param: string]>(name)`: вызов `Family(param)` → `TokenString<T>` с id `"<name>:<param>"`, мемоизация и внутренний реестр членов `param ↔ token` (design D2, D3); экспорт из `providers/` и `index.ts`
- [x] 1.2 Рантайм-тесты семейства: id члена, мемоизация повторного вызова, член пригоден как обычный `InjectionToken` (в `@Injectable` deps и `get`/`getOrThrow`)

## 2. familyProvider и материализация членов на build() (nestling.container)

- [x] 2.1 `FamilyProviderDefinition { family, recipe }` + `familyProvider(family, recipe)` + type guard `isFamilyDefinition`; типизация рецепта `(param) => ProviderDefinition<T>` (design D1, D5)
- [x] 2.2 Приём family-определений в `ContainerBuilder.register()` (проверка `isFamilyDefinition` ДО `isModule`) и в `providers` модуля (массив и `ProvidersFactory`); хранение «семейство → рецепт + moduleName»; ошибка при повторной регистрации рецепта для того же семейства
- [x] 2.3 Фаза материализации в `build()` (после `appendFactoryProviders()`, до `instantiateAll()`): сбор членов из deps всех провайдеров через реестры зарегистрированных семейств, вызов рецепта один раз на уникальный параметр, регистрация результата обычным провайдером с moduleName рецепта; итерация до фикспоинта с жёстким лимитом итераций (design D4)
- [x] 2.4 Ошибки материализации: несовпадение `provide` результата рецепта с токеном члена (семейство + параметр + фактический токен в тексте); член в deps без зарегистрированного рецепта (семейство + параметр); рецепт бросил (обёртка с контекстом)
- [x] 2.5 Рантайм-тесты сборки с семействами: дедупликация (два потребителя одного члена → один вызов рецепта, один узел, общий инстанс); разные параметры → разные узлы; рецепт-провайдер deps'ит члена другого семейства (фикспоинт); неупомянутый член не материализуется (`get` → `null`)
- [x] 2.6 Рантайм-тесты ошибок: wrong-provide, отсутствующий рецепт, дубликат рецепта, превышение лимита фикспоинта (рецепт порождает новых членов бесконечно)
- [x] 2.7 Рантайм-тесты «член — обычный узел»: цикл через члена семейства → ошибка сборки; `@OnInit`/`@OnDestroy` члена вызываются ровно один раз на `init()`/`destroy()`; module-атрибуция члена (`metadata.module` модуля рецепта; `undefined` при прямой регистрации)

## 3. Consumer-aware сахар: Family.auto (nestling.container)

- [x] 3.1 Сентинел `Family.auto` (брендированная строка + реестр сентинелов семейства), типизированный как `TokenString<T>` (design D6)
- [x] 3.2 Резолюция сентинелов в `Injectable` при декорировании: замена на `family(constructor.name)` в сохраняемых метаданных; ошибка на классе с пустым `constructor.name`
- [x] 3.3 Отказ вне классов: сентинел в deps фабричного/иного определения → ошибка регистрации/сборки с подсказкой «используйте `Family('<имя>')` явно»
- [x] 3.4 Рантайм-тесты `.auto`: резолюция в член по имени класса; два класса → два разных члена из одного рецепта; дедупликация `.auto`-члена с явным `Family('ИмяКласса')`; ошибка в deps `factoryProvider`; ошибка на анонимном классе

## 4. strictExports (nestling.container)

- [x] 4.1 Опции конструктора `new ContainerBuilder({ strictExports?: boolean })`; по умолчанию поведение неизменно (design D7)
- [x] 4.2 Расширение `Module.exports` до `(InjectionToken | TokenFamily)[]`; учёт семейств в `#moduleExports` отдельной веткой (НЕ через `stringifyToken` — у функции взялся бы `.name`) и в `metadata.exported` членов
- [x] 4.3 Проверка рёбер после `buildDependencyGraph()`: кросс-модульное (или из безмодульного потребителя) ребро на неэкспортированный токен модуля → нарушение; внутримодульные рёбра и зависимости без модуля — свободно; отсутствующий/пустой `exports` = ничего не экспортировано; агрегация всех нарушений в одну ошибку со списком «consumer → dep (module)»
- [x] 4.4 Рантайм-тесты strictExports позитив: экспортированный токен — сборка ок; внутримодульное ребро на неэкспортированный — ок; выключенный флаг — кросс-модульное на неэкспортированный ок (обратная совместимость); `exports: [Family]` → член потребляется кросс-модульно, `metadata.exported === true`
- [x] 4.5 Рантайм-тесты strictExports негатив: неэкспортированный токен кросс-модульно → ошибка; модуль без `exports` → ошибка; неэкспортированное семейство → ошибка по членскому токену; два нарушения → одна ошибка с обоими

## 5. Миграция примера (examples.simple-app)

- [x] 5.1 Переписать `src/logging/registry.ts` + `logging.module.ts` на `makeTokenFamily`/`familyProvider` (убрать ручной Set и `ProvidersFactory`-штамповку); проверить, что `main.ts` и потребители (`ILogger('app')`, `ILogger('db')`, ...) работают без изменений
- [x] 5.2 Продемонстрировать `.auto` хотя бы у одного потребителя примера; прогнать пример (build/init/работа/destroy)

## 6. Документация и финализация

- [x] 6.1 README (`packages/nestling.container/README.md` + `README.ru.md`): разделы про token families (`makeTokenFamily`, `familyProvider`, `.auto`, правило «члены — только через вызов семейства») и `strictExports`
- [x] 6.2 `docs/guides/`: дополнить DI-гайд (`http-app-di.md`) или добавить гайд по семействам токенов — по необходимости
- [x] 6.3 Запись в `docs/decisions/archlog.md` о введении token families и strictExports (на этапе apply, не раньше)
- [x] 6.4 `yarn test` в `@nestling/container` и `examples.simple-app` — зелёные; `yarn lint` по затронутым пакетам
- [x] 6.5 Обновить статус change #5 в `docs/decisions/roadmap.md` (после archive)
