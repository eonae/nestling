## 1. Схемный слой: аннотация `jsonSchema`

- [x] 1.1 Добавить `jsonSchema(schema, json)` в `packages/nestling.pipeline/src/schema/converter.ts`: значение-аннотация, наследующее `~standard` исходной схемы и несущее объявленную JSON Schema неперечислимым symbol-свойством (бренд по образцу `HTTP_BINDING`/`ENDPOINT_BRAND`); экспорт из `index.ts` пакета
- [x] 1.2 Научить диспетчер предпочитать аннотацию: `jsonSchemaOf(leaf)` рядом с `pickConverter`; исход «есть объявленная схема» отличается и от «конвертер найден», и от «конвертера нет»
- [x] 1.3 Рантайм-тесты: аннотированная zod-схема валидирует идентично исходной (успех и `issues`); аннотация читается через диспетчер при пустом списке конвертеров и приоритетнее подходящего конвертера; исходная схема не мутирована
- [x] 1.4 Учесть аннотацию в `describeLeaf` (`packages/nestling.ports/src/describe.ts`): аннотированный лист даёт `leaf: 'schema'` с объявленной JSON Schema и вендором исходной схемы, а не `opaque`; тест на дескриптор без конвертеров

## 2. Слот `doc:` на декларациях и контрактах

- [x] 2.1 Тип `DeclarationDoc` (`summary`, `description`, `tags`, `deprecated`, `status`, `hidden`) в `@nestling/pipeline`; поле `doc?` в `EndpointOptions` и `EndpointDefinition`, перенос в `EndpointState` и в `buildDefinition` (переживает `resolve` наравне с `binding`/`errors`/`detached`)
- [x] 2.2 `assertDoc(doc, pattern)` в `makeEndpoint`: не-строки, `tags` не массивом строк, `status` вне `successStatuses`, `hidden` не непустой строкой, неизвестное поле секции — ошибки в точке создания с текстом, называющим ручку и поле
- [x] 2.3 Поле `doc?` в `ContractSpec`/`Contract` (`@nestling/contracts`) с теми же проверками и текстом, называющим контракт; общая реализация проверки, два места вызова — как у `computeHttpBinding`
- [x] 2.4 `doc` в `HttpEndpointDictionary` и в `CONTRACT_OWNED` (`@nestling/transport.http/src/helpers.ts`): контракт-форма берёт `doc` с контракта, переобъявление отвергается типами и рантаймом
- [x] 2.5 Рантайм-тесты слота: перенос через `resolve`, каждый fail-fast словаря, контракт-форма (наследование и переобъявление)

## 3. Инжектируемая дискавери

- [x] 3.1 Токен `Discovery$` и заморозка результата `discoverEndpoints` (`packages/nestling.app`): списки и карта транспортов read-only
- [x] 3.2 Регистрация провайдера-значения в `App.#assemble` — всегда, рядом с kernel-модулями; дискавери считается один раз за сборку
- [x] 3.3 Тесты: модуль с `deps: [Discovery$]` получает состав приложения; `select` отражён в значении; значение не позволяет менять состав; тестовый корень (`assembleTest`) видит то же значение

## 4. Пакет `@nestling/openapi`: ядро генератора

- [x] 4.1 Скаффолд пакета `packages/nestling.openapi` по образцу `nestling.client` (package.json, tsconfig, tsconfig.lint.json, jest.config.js, eslint.config.js, nx-таргеты)
- [x] 4.2 Типы документа: `OpenApiDocument`, `OpenApiOptions` (`info`, `converters`, `servers?`, `security?`, `securitySchemes?`, `externalDocs?`), `DocumentedEndpoint` (структурно совместим с `DiscoveredEndpoint`)
- [x] 4.3 Отбор ручек: только носители HTTP bind-карты (`isHttpBinding`); `doc.hidden` исключает ручку из документа и из проверки схем; дубль `(метод, путь)` — ошибка, называющая обе ручки и их модули
- [x] 4.4 Путь и `operationId`: `:param` → `{param}`, метод в нижнем регистре; имя операции — subject bus-биндинга (`busBindingOf`), иначе детерминированный слаг от метода и пути
- [x] 4.5 Разложение входа: одна конвертация `input` → JSON Schema, затем разбор по bind-карте (`path`/`query`/`rest`), `required` из конвертированной схемы, `multiple` → массив, `style: form` + `explode: true`; вычитание вынесенных полей из `properties` и `required` для `requestBody`
- [x] 4.6 Диагностики разложения: path-параметр без свойства в схеме; `bind`-пометка на несуществующем поле; неразложимая (не-объектная) схема входа при непустой карте — тексты называют ручку, слот и способ починки
- [x] 4.7 Media types из `mediaTypeOf`: `value`/`stream`/`events`/`multipart`/примитивы; для `stream` схема — элемент, для `events` схема элемента в `description`; `multipart` — поля плюс файлы (`format: 'binary'`, массив при `multiple`, `contentMediaType` из `upload({ mime })`); `rawBody` на media type не влияет
- [x] 4.8 `responses`: успешный код из `doc.status` (дефолт `200`, `204` без `output`); отказ на код своего статуса с телом `{ error, code: const, details? }`; `oneOf` при совпадении кодов; автоматический `400` (`VALIDATION_FAILED`) при наличии схемы входа; `default` — `UnknownError`
- [x] 4.9 Вынести `httpCodeOf(status)` из `STATUS_MAP` (`@nestling/transport.http/src/adapter.ts`) в публичный экспорт и использовать его в генераторе; второй копии таблицы не заводить
- [x] 4.10 Тотальность проверки конвертируемости: собрать нарушения по всем ручкам и всем слотам (включая `details` каждого отказа и `fields` формы `multipart`) и бросить одним сообщением
- [x] 4.11 Тест границы импортов пакета по образцу `contracts-package-boundary`: ни одного валидатора в графе импортов `dist/`

## 5. Конвертер `@nestling/openapi.zod`

- [x] 5.1 Скаффолд пакета `packages/nestling.openapi.zod` с peer-зависимостью `zod ^4.0.0`
- [x] 5.2 `zodConverter(): SchemaDocConverter` поверх `z.toJSONSchema()`
- [x] 5.3 Тест: результат совпадает с прямым вызовом `z.toJSONSchema()`; конвертер выбирается диспетчером по `vendor: 'zod'`

## 6. Модуль-издатель

- [x] 6.1 `openapi(options)` → модуль-значение: провайдер документа (`factoryProvider(OpenApiDocument$, …, [Discovery$])`) и ручка `GET /openapi.json`; опции `path`, `pipeline`, `detached`; собственная ручка помечена `doc: { hidden }`
- [x] 6.2 Печать списка скрытых ручек с причинами на старте — рядом со списком `detached`-ручек; в документ список не попадает
- [x] 6.3 Интеграционные тесты: документ отдаётся ручкой и не описывает сам себя; непокрытая схема роняет сборку **на фазе ASSEMBLE** (сокет не открыт, `@OnInit` не выполнялся); `select` сужает документ; ручка модуля удовлетворяет политике при переданном `pipeline` и нарушает её без него

## 7. Пример и документация

- [x] 7.1 Подключить `openapi({ info, converters: [zodConverter()], pipeline: … })` в `packages/examples.app-with-http`, снабдить `doc:` несколько ручек (в том числе `hidden` для `/health`) и добавить строку про `GET /openapi.json` в вывод старта
- [x] 7.2 Тест примера: документ содержит все публичные ручки, коды ответов совпадают с реальными ответами транспорта для пары проверенных случаев (`201`, `409`)
- [x] 7.3 Новый гайд `docs/guides/openapi.md` с плашкой «сверено с кодом `examples.app-with-http` (дата)»
- [x] 7.4 README новых пакетов (`@nestling/openapi`, `@nestling/openapi.zod`) с плашками статуса; обновить README `@nestling/pipeline`, `@nestling/contracts`, `@nestling/transport.http`, `@nestling/app`, `@nestling/ports`
- [x] 7.5 Синхронизировать `docs/design/schemas.md` (§2.1 — конкретная поверхность: модуль, слот `doc`, аннотация), `docs/design/endpoints.md` и `docs/design/contracts.md` (слот `doc`), `docs/design/README.md` при необходимости
- [x] 7.6 Дописать блок «РЕАЛИЗОВАНО/УТОЧНЕНО» под секцией [2026-07-13] «Схемы…» в `docs/decisions/ideas.md`: слот `doc` вместо разрозненных полей, аннотация вместо `jsonSchema`-поля декларации, `Discovery$`, OpenAPI 3.1, выводимый `operationId`, отказ от тегов по имени модуля
- [x] 7.7 Занести в `docs/decisions/deferred.md` открытый вопрос «типизированный успешный статус в декларации» с триггером возврата

## 8. Definition of Done

- [x] 8.1 Все задачи выше отмечены
- [x] 8.2 `yarn verify` зелёный (build + lint + test + type-budget по всем пакетам)
- [x] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 8.5 `yarn docs:audit` — 0 ERROR
- [x] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с обновлённой датой в плашке «сверено с кодом»
- [x] 8.7 Коммиты осмысленные; **push не выполнен** — у окружения нет прав
      на `git@github.com:eonae/nestling.git` (`Please make sure you have the
      correct access rights`). Работа идёт в ветке `autorun/v1-all-waves`
      (все волны подряд), она готова к пушу
