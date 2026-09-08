## 1. Ядро: конверт ответа и `Ok` без заголовков

- [x] 1.1 `@nestling/operations`: `TransportResponse<TValue>` и предикат
      `isTransportResponse` в новом файле `src/transport-response.ts`,
      экспорт из `src/index.ts`
- [x] 1.2 `@nestling/operations`: убрать заголовки из `Ok` — параметр
      конструктора, вторые параметры `Ok.created`/`Ok.accepted`, параметр
      `Ok.noContent`, поле `headers`; JSDoc класса переписать
- [x] 1.3 `@nestling/app`: заменить `headers` на
      `transport?: { name: string; meta: unknown }` в
      `SuccessResponseContext`, убрать `headers` из `ErrorResponseContext`
- [x] 1.4 `@nestling/app`: ветка конверта в `normalizeResponse` —
      разбор `result` тем же кодом, метаданные в контекст ответа
- [x] 1.5 Спеки ядра: конверт распознаётся, `Ok` без заголовков,
      контекст ответа несёт метаданные транспорта

## 2. Ядро: интерфейсы хендлера

- [x] 2.1 `@nestling/app`: `HandlerMeta` — `signal` плюс поля контекста
- [x] 2.2 `@nestling/app`: интерфейс `Handler<C>`, выведенный из операции
- [x] 2.3 `@nestling/app`: экспорт декоратора `Handler` из
      `@nestling/container` под тем же именем, чтобы интерфейс и декоратор
      приходили одним импортом
- [x] 2.4 `@nestling/app`: параметр `PR` и `ValidateStart<PR, EmptyInput>`
      в слоте `pipeline` у `implement`; литерал ошибки в форме соседей
- [x] 2.5 Type-tests: `implements Handler<typeof Op>` ловит расхождение с
      операцией; HTTP-пайплайн не проходит в `implement`

## 3. HTTP: запрос в стартовом контексте

- [x] 3.1 `HttpRequest` и `HttpStartContext` в
      `packages/nestling.transport.http/src/`; `StartContext` дополняется
      полем `http`
- [x] 3.2 `transport.ts`: сборка `HttpRequest` из `IncomingMessage` без
      копирования заголовков, запись в стартовый контекст
- [x] 3.3 `helpers.ts`: анонимные перегрузки `httpEndpoint` типизируют
      `meta` как `P & { http: HttpRequest }`; форма с `operation:`
      остаётся без пересечения
- [x] 3.4 `HttpHandlerMeta` и `HttpHandler<C>`
- [x] 3.5 Type-tests: HTTP-класс не проходит в форму с `operation:` и в
      `implement`; нейтральный класс проходит в обе формы

## 4. HTTP: форма ответа

- [x] 4.1 `HttpResponse`, `Cookie`, `HttpResponseOptions`,
      `RedirectOptions` в новом файле `src/response.ts`
- [x] 4.2 `HttpOutputSync` и `HttpOutput`; слоты `handler` анонимной формы
      принимают их
- [x] 4.3 Поле `redirect` у `HttpEndpointDictionary`; проверка при
      создании декларации, что `redirect` не объявлен вместе с потоковой
      формой `output`
- [x] 4.4 `adapter.ts`: статус, заголовки и `Set-Cookie` из метаданных
      ответа; правило перекрытия по нижнему регистру сохраняется
- [x] 4.5 `adapter.ts`: заголовки потокового ответа до первого кадра
- [x] 4.6 Ответ `internal_error` на редирект без объявленного `redirect`;
      текст называет endpoint и поле
- [x] 4.7 Ответ `internal_error` на метаданные чужого транспорта; текст
      называет endpoint и оба имени
- [x] 4.8 Спеки транспорта: cookie двумя заголовками, редирект со
      статусом и `Location`, статус вызова перекрывает объявленный

## 5. HTTP: юниты транспорта

- [x] 5.1 `src/units.ts`: `withHeader(name)`, `withClientIp()`,
      `httpAccessLog(logger)`; экспорт из `index.ts`
- [x] 5.2 Спеки юнитов: поле под именем заголовка, `clientIp` из адреса
      сокета, строка доступа со счётчиками байтов
- [x] 5.3 Type-tests: юнит транспорта не растит `TNeeds`; пайплайн с ним
      не проходит в `implement`

## 6. Соседние пакеты

- [x] 6.1 `@nestling/openapi`: ответ 3xx с `Location` по полю `redirect`,
      успешный ответ по `doc.status` в этом случае не добавляется
- [x] 6.2 `@nestling/transport.nats`: убрать чтение `response.headers`
- [x] 6.3 `@nestling/transport.cli`: убрать чтение `response.headers`,
      если оно есть
- [x] 6.4 `@nestling/testing`: поле `input` в `TestCallOptions`, передача
      в `makeEmptyContext`
- [x] 6.5 Спека OpenAPI и спека тестового вызова

## 7. Примеры и замер

- [x] 7.1 `examples/users-service`: `create-user.endpoint.ts` на
      `HttpResponse.of`
- [x] 7.2 `examples/app-with-http`: `create-user.endpoint.ts` на
      `HttpResponse.of`; проверить `activity-stream.endpoint.ts`
- [x] 7.3 Пример HTTP-хендлера с редиректом и cookie в
      `examples/app-with-http`
- [x] 7.4 `yarn bench:http` под Node 24 до и после; результат в записи
      change'а, порог — не хуже 2% на `GET` и `POST`

## 8. Гайд

- [x] 8.1 Глава 4: `Ok` без заголовков, `HttpResponse` для `Location`
- [x] 8.2 Глава 11: потоковый ответ с заголовками
- [x] 8.3 Главы 13 и 27: `Ok.created(user, { Location })` переписать
- [x] 8.4 Глава 15 и глава 24: проверить сниппеты `new Ok(...)`
- [x] 8.5 Глава 10: HTTP-хендлер с cookie и редиректом, юниты транспорта
- [x] 8.6 Приложения А и Б: строки про заголовки ответа
- [x] 8.7 Карта понятий и оглавление, если состав понятий изменился

## 9. Документация и журнал

- [x] 9.1 README `@nestling/transport.http`: HTTP-форма хендлера, юниты,
      запись ответа, плашка статуса
- [x] 9.2 README `@nestling/app` и `@nestling/operations`: интерфейсы
      хендлера, конверт ответа, `Ok` без заголовков
- [x] 9.3 README `@nestling/openapi`: редирект в документе
- [x] 9.4 `docs/design/transports.md`: сигнатура `httpAccessLog(logger)`
      в §1.2
- [x] 9.5 `docs/decisions/deferred.md`: переформулировать под-тему
      «типизация ответных заголовков»
- [x] 9.6 `docs/decisions/ideas.md`: отметить запись [2026-09-06]
      реализованной; пометка superseded на записи [2026-09-03] уже стоит
- [x] 9.7 `docs/decisions/roadmap.md`: статус change'а 50

## 10. Definition of Done

- [x] 10.1 Все задачи выше отмечены
- [x] 10.2 `yarn verify` зелёный
- [x] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 10.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 10.5 `yarn docs:audit` — 0 ERROR
- [x] 10.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 10.7 Коммиты осмысленные, ветка `change/http-handler-form` запушена
