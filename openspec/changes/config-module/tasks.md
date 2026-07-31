## 1. Схемный кернел переезжает вниз (D1)

- [x] 1.1 Перенести `validate.ts`, `errors.ts` и тип `DomainType` из
      `packages/nestling.pipeline/src/schema/` в `packages/common.misc/src/`
      (вместе с `validate.spec.ts` и прочими тестами схемного кернела)
- [x] 1.2 Заменить внутренние импорты pipeline на `@common/misc`; оставить
      `packages/nestling.pipeline/src/schema/index.ts` реэкспортом
      (`validateSync`, `assertStandardSchema`, `SchemaValidationError`,
      `SchemaIssue`, `normalizeIssues`, `AsyncSchemaNotSupportedError`,
      `NotAStandardSchemaError`, `DomainType`)
- [x] 1.3 Тест публичного API: перечисленные имена импортируются из
      `@nestling/pipeline` и идентичны импортам из `@common/misc`
- [x] 1.4 `yarn verify` зелёный до появления новых пакетов (шаг самостоятелен)

## 2. Каркас пакета `@nestling/config`

- [x] 2.1 Завести `packages/nestling.config` по образцу
      `packages/nestling.streams` (`package.json`, `tsconfig.json`,
      `tsconfig.lint.json`, `eslint.config.js`, `jest.config.js`, `README.md`)
- [x] 2.2 Зависимости — `@nestling/container`, `@nestling/streams`,
      `@common/misc`; валидатор схем в зависимостях отсутствует
- [x] 2.3 Прописать пакет в workspace/nx и убедиться, что `build`/`lint`/`test`
      поднимаются на пустом `src/index.ts`

## 3. Объявление секции и деривация ключей (config-sections)

- [x] 3.1 `from(key, schema)` — обёртка листа с точным именем ключа; тип-хелпер
      снимает обёртку при выводе
- [x] 3.2 Деривация имени: `camelCase → SCREAMING_SNAKE` + префикс по правилу
      D5; юнит-тесты на `maxItems`, `httpURL`, цифры, `from()`
- [x] 3.3 `makeConfig(prefix, record)` — валидация формы рекорда
      (`assertStandardSchema` на каждый лист с именем секции и поля в ошибке)
- [x] 3.4 Токен секции — не-инстанцируемый класс с перекрытым `name`
      (id члена семейства) и статикой `.keys`; конструктор бросает именующую
      ошибку (D2); тесты на `new Section()` и на `stringifyToken(Section)`
- [x] 3.5 Тип `Config<typeof Section>` — проекция выходов схем полей;
      type-тесты на вывод и на ошибку обращения к несуществующему полю

## 4. Реестр объявлений (config-registry)

- [x] 4.1 Реестр «префикс → декларация»: поля, ключи, флаг `reloadable`;
      идемпотентность по идентичности декларации, ошибка на конфликт префиксов
- [x] 4.2 `Section.keys` — branded `ConfigKeys<Prefix>` с рантайм-набором
      ключей; тип не инжектируем (type-тест)
- [x] 4.3 Регистрация unbound-глобов пакетами (`keysGlob('*_GRPC_ADDRESS')`
      или эквивалент) и попадание их в реестр

## 5. Читалка и источники (config-sources-binding)

- [x] 5.1 Интерфейс `ConfigSource { get; init?; watch?; close? }` — публичный
      тип; читалка и её токен — приватные (не в `index.ts`)
- [x] 5.2 `ConfigReader`: разрешение ключа по привязкам (порядок = приоритет),
      `process.env` как неявный пол, `undefined` при отсутствии
- [x] 5.3 Матчинг таргетов: `ConfigKeys`-хэндл, глоб `'*_SUFFIX'`, `'*'`;
      источник не опрашивается для ключей вне его таргета (тест на вызовы `get`)
- [x] 5.4 `init()` источников в асинхронной фабрике читалки; `@OnDestroy`
      закрывает источники; тесты порядка init → проекция и destroy → close
- [x] 5.5 `onWarn` (по умолчанию `console.warn` с префиксом `[nestling/config]`)
      и предупреждение о таргете, не покрывшем ни одного объявленного ключа
- [x] 5.6 Тестовый объектный источник (`objectSource(record)`) для юнит-тестов
      пакета — без файлов и сети

## 6. Материализация секций через token families (config-sections)

- [x] 6.1 Семейство `ConfigSection` + фреймворковый `familyProvider`: рецепт
      находит декларацию в реестре по префиксу и возвращает `factoryProvider`
      с зависимостью от читалки
- [x] 6.2 Kernel-модуль конфига (`configKernel(bindings)`), собирающий читалку и
      рецепты семейств
- [x] 6.3 Рантайм-тесты на графе: инжект секции материализует узел; секция без
      потребителей в граф не попадает; узел участвует в топосорте и виден
      контейнеру (`getOrThrow`)

## 7. Проекция и валидация полей (config-sections)

- [x] 7.1 Проекция нереloadable-секции: независимая валидация каждого поля
      через `validateSync`, заморозка результата
- [x] 7.2 `ConfigValidationError`: секция, все проваленные поля с ключами и
      `issues`, перечень опрошенных источников
- [x] 7.3 Рантайм-тесты fail-fast: `build()` падает на невалидном значении;
      перечислены оба проваленных поля из трёх; `default`/`optional` для
      отсутствующего ключа проходят; обязательный отсутствующий — падает

## 8. Reloadable (config-reloadable)

- [x] 8.1 `makeConfig.reloadable` — флаг в декларации; проекция через геттеры
      поверх приватного снапшота; `onChange` отсутствует у обычной секции
      (type-тест)
- [x] 8.2 Подписка читалки на `watch` источников; перепроекция reloadable-секций;
      публикация нового значения в `Topic`
- [x] 8.3 `onChange(signal, cb)` с отпиской по `AbortSignal`; тест на
      освобождение подписки
- [x] 8.4 Keep-last-good + warn на невалидном обновлении; тест на отсутствие
      частично применённого состояния
- [x] 8.5 Warn на старте, если ключи reloadable-секции не покрыты источником с
      `watch`

## 9. Семейство одиночных ключей (config-registry)

- [x] 9.1 Публичное семейство `Config(key)` — сырое значение из читалки, без
      валидации
- [x] 9.2 Рантайм-тест on-demand-сценария: провайдер зависит от
      `Config(addressKey('users'))`, ключ материализуется на `build()`,
      разрешается по общим правилам приоритета

## 10. Интеграция в корень (`@nestling/app`)

- [x] 10.1 `AppConfig.config?: ConfigBinding[]`; типы `ConfigBinding`/
      `ConfigTarget` реэкспортируются из `@nestling/config`
- [x] 10.2 App регистрирует kernel-модуль конфига **всегда**; приложение без
      поля `config` читает секции из `process.env`
- [x] 10.3 Тесты: прогрессивность (нет `config` в корне), приоритет источников,
      падение старта на невалидном конфиге до `listen()`

## 11. Пример и гайд

- [x] 11.1 Мигрировать `packages/examples.simple-app`: ручной `ConfigModule`
      (`src/config/config.module.ts`) → секция `makeConfig` с экспортом только
      `.keys`; `IConfig` из `interfaces.ts` убрать или свести к секции
- [x] 11.2 Показать в примере обе капли: чтение из env и привязку объектного
      источника в корне
- [x] 11.3 Новый гайд `docs/guides/config.md` со сверкой по коду примера и
      плашкой «сверено с кодом <пример> (дата)»

## 12. Документация и журнал

- [x] 12.1 `README.md` нового пакета: назначение, kernel/user-граница, плашка
      статуса, ссылка на `docs/design/config.md`
- [x] 12.2 README затронутых пакетов: `@nestling/app` (поле `config`),
      `@nestling/pipeline` (схемный кернел переехал, реэкспорт),
      `@common/misc` (новый дом `validateSync`), `@nestling/streams` (ссылка на
      реального потребителя `Topic`)
- [x] 12.3 `docs/design/config.md` — уточнить по факту реализованного: форма
      токена секции и `.keys`, точка привязки до появления `assemble()`,
      предупреждение о непокрытом таргете; плашка и ссылки в силе
- [x] 12.4 `docs/decisions/roadmap.md` — статус change #9; запись в
      `ideas.md` **не** добавлять без явного «запиши» от пользователя
      (правило CLAUDE.md) — вместо этого предложить её текст в отчёте

## 13. Definition of Done

- [ ] 13.1 Все задачи `tasks.md` отмечены
- [ ] 13.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [ ] 13.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 13.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [ ] 13.5 `yarn docs:audit` — 0 ERROR
- [ ] 13.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 13.7 Коммиты осмысленные, ветка `change/config-module` запушена
</content>
