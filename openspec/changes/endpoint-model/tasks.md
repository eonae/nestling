## 1. Ядро деклараций (`@nestling/pipeline`)

- [x] 1.1 Добавить четвёртый тип-параметр неразрешённых зависимостей в
      `EndpointDefinition<I, O, P, TNeeds = never>`
      (`src/metadata/endpoint.ts`), симметрично `Pipeline<TReq, TAcc, TNeeds>`
- [x] 1.2 Ввести поле `deps` (явный массив `InjectionToken`) и типы трёх форм
      `handle`: `HandlerFn` (существующая), каррированная фабрика
      `(…UnwrapInjectionTokens<D>) => HandlerFn`, конструктор класса с `handle`
- [x] 1.3 Переписать `makeEndpoint` из identity-функции в конструктор:
      три упорядоченные перегрузки (функция → каррированная → класс),
      нормализация `handle` во внутреннее представление, symbol-бренд
      `Symbol.for('nestling:endpoint')` неперечислимым свойством
- [x] 1.4 Реализовать `resolve` на значении декларации: перегрузки
      «резолвер-функция» и «позиционный массив инстансов», возврат **нового**
      значения с `TNeeds = never`, ошибка с именем токена, если резолвер не
      отдал зависимость
- [x] 1.5 Экспортировать предикат бренда (`isEndpointDefinition`) для дискавери
- [x] 1.6 Удалить `Endpoint`, `getEndpointMetadata`, `EndpointMetadata` и
      `HANDLER_KEY` из `src/metadata/endpoint.ts`; удалить `IEndpoint` из
      `src/core/types/endpoint.ts`, оставив `HandlerFn` как самостоятельный тип
- [x] 1.7 Рантайм-тесты: три формы `handle` исполняются; каррированная фабрика
      вызывается ровно один раз на несколько запросов; `resolve` не мутирует
      исходную декларацию и допускает повторное гашение разными наборами;
      бренд не участвует в `Object.keys`; ошибка нерезолвленного токена
- [x] 1.8 Type-тесты: `TNeeds` равен `never` для deps-free формы, содержит
      токены для каррированной и конструктор для класс-формы; несовпадение
      сигнатуры `handle` со схемами `input`/`output` — ошибка компиляции

## 2. Контракт транспорта (`@nestling/transport`)

- [x] 2.1 Сузить `ITransport.endpoint()` до `EndpointDefinition<I, O, P, never>`
      (`src/interfaces.ts`)
- [x] 2.2 Type-тест: декларация с зависимостями не проходит в `ITransport.endpoint()`

## 3. HTTP-конструктор (`@nestling/transport.http`)

- [x] 3.1 Реализовать `httpEndpoint({ method, path, input, output, pipeline,
      deps, handle })` генериком по литеральному `path`; `pattern` собирается
      как `` `${method} ${path}` ``; конструктор — тонкая обёртка над
      `makeEndpoint`
- [x] 3.2 Экспортировать тип `PathParams<Path>` — union имён `:param`-сегментов
      шаблона; оформить точку расширения словаря под bind-карту change'а
      `input-bind` (комментарий-якорь + место в типе)
- [x] 3.3 Fail-fast конструктора при создании: пустой `path`, `path` без
      ведущего `/`, повторяющиеся имена path-параметров
- [x] 3.4 Удалить `HttpEndpoint`, `HttpEndpointOptions`, `HttpEndpointMetadata`,
      `getHttpEndpointMetadata`, `makeHttpEndpoint` (`src/helpers.ts`)
- [x] 3.5 Сузить `HttpTransport.route()` и `HttpTransport.endpoint()` до
      deps-free декларации (`src/transport.ts`); проверить, что `router.ts`
      читает `transport`/`pattern` с самой декларации
- [x] 3.6 Тесты: fail-fast конструктора (три правила); type-тесты `PathParams`
      на шаблоне с двумя параметрами и без параметров; интеграционный тест
      транспорта на декларации, созданной `httpEndpoint`

## 4. CLI-конструктор (`@nestling/transport.cli`)

- [x] 4.1 Реализовать `cliEndpoint({ command, input, output, pipeline, deps,
      handle })` → `transport: 'cli'`, `pattern: command`
- [x] 4.2 Fail-fast при пустом имени команды
- [x] 4.3 Тесты конструктора и обслуживания команды через `CliTransport`

## 5. Сборка приложения (`@nestling/app`)

- [x] 5.1 `AppModule.endpoints` — список деклараций-значений вместо
      `Constructor<IEndpoint>[]` (`src/module.ts`)
- [x] 5.2 Убрать `withEndpoints`: `makeAppModule` больше не подмешивает
      эндпоинты в `providers`, но сохраняет поле `endpoints` в значении
- [x] 5.3 Дискавери на значениях (`src/discovery.ts`): `DiscoveredEndpoint`
      несёт декларацию и `moduleName`; `transport`/`pattern` читаются с
      декларации; дедупликация внутри модуля — по ссылке на значение
- [x] 5.4 Заменить проверку «класс без метаданных» на проверку бренда с
      ошибкой, называющей модуль и индекс элемента в `endpoints:`
- [x] 5.5 Удалить `assertEndpointsDeclared` и его вызов из `App`
- [x] 5.6 `#registerEndpoints`: вместо `container.get(EndpointClass)` —
      `endpoint.resolve(resolver)` (внутри него тем же резолвером идёт
      `pipeline.bind`, см. уточнение D1/D3 в design.md); ошибки
      старта называют паттерн ручки, модуль-объявитель и недостающую
      зависимость (токен, класс-хендлер или класс-юнит)
- [x] 5.7 Перевести `MockTransport` в `src/helpers.ts` на deps-free декларации
- [x] 5.8 Обновить `app.spec.ts`, `module.spec.ts`, `discovery.spec.ts`:
      сценарии дискавери на значениях, отсутствие транспорта, элемент без
      бренда, нерезолвимые `deps` и класс-хендлер, гашение на старте

## 6. Примеры

- [x] 6.1 `examples.app-with-http`: перевести 9 деклараций
      (`create-user`, `delete-user`, `export-users`, `get-user`,
      `import-users`, `list-users`, `search-users`, `update-user`,
      `upload-avatar`) с `@Injectable`+`@HttpEndpoint` на `httpEndpoint`;
      показать обе DI-формы — часть ручек каррированной фабрикой, часть
      класс-хендлером
- [x] 6.2 `examples.app-with-http`: класс-хендлеры добавлены в `providers`
      модулей; `endpoints:` содержит значения; приложение поднимается и
      обслуживает запросы
- [x] 6.3 `examples.simple-http-server`: перевести `say-hello`,
      `create-user`, `stream-logs` с `makeEndpoint` на `httpEndpoint`
      (standalone, deps-free)
- [x] 6.4 `examples.simple-cli`: перевести `help` и `process-stdin` на
      `cliEndpoint`
- [x] 6.5 Переименовать директории `endpoints.functional/` — стиль больше не
      «функциональный вариант», а единственный

## 7. Документация

- [x] 7.1 Сверить `docs/design/endpoints.md` с реализацией; расхождения
      (имена, форма `resolve`, объём словаря) — поправить по месту
- [x] 7.2 Проверить и поправить упоминания endpoint-деклараций в
      `docs/design/transports.md` и `docs/design/composition.md`
- [x] 7.3 Запись в `docs/decisions/ideas.md` — **только по явной просьбе
      пользователя**; иначе зафиксировать решения этого change'а через
      `openspec` и `docs/decisions/archlog.md` при архивации
- [x] 7.4 Переписать `docs/guides/http-app-di.md` на новый канон (снять
      предупреждение «стиль уходит», обновить заголовок и дату плашки
      «сверено с кодом `examples.app-with-http`»)
- [x] 7.5 Обновить `docs/guides/http-functional.md` и `docs/guides/cli.md`:
      `httpEndpoint`/`cliEndpoint` вместо `makeEndpoint`, снятые
      предупреждения, новые даты в плашках
- [x] 7.6 README пакетов `nestling.pipeline`, `nestling.app`,
      `nestling.transport`, `nestling.transport.http`,
      `nestling.transport.cli` — плашки статуса и разделы про декларации
- [x] 7.7 Обновить `docs/preview/`, если затронутые страницы там есть
- [x] 7.8 Отметить статус change #24 в `docs/decisions/roadmap.md`

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 Коммиты осмысленные, ветка `change/endpoint-model` запушена
