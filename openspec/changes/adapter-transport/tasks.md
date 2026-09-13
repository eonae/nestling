## 1. Развязка байтового пути с `node:http`

- [x] 1.1 Переименовать `packages/nestling.transport.http/src/adapter.ts`
      в `framing.ts` вместе с его спекой; поправить импорты внутри пакета.
      Барель не меняется: `sendResponse` и `httpCodeOf` экспортируются
      из того же места
- [x] 1.2 Объявить `HttpSource` и `HttpSink` в новом
      `src/interfaces.ts` — подмножество формы `IncomingMessage` и
      `ServerResponse`, которым пользуется код (список — в design.md §5)
- [x] 1.3 Перевести `framing.ts` (`sendResponse`, `writeChunk`,
      `writeNdjson`, `writeSse`, `setStreamHeaders`) с `ServerResponse` на
      `HttpSink`
- [x] 1.4 Перевести `parser.ts` (`readBody`, `parseJson`, `parseRaw`,
      `parseNdjson`, `parseMultipartForm`) и `router.ts` (`find`) с
      `IncomingMessage` на `HttpSource`
- [x] 1.5 Перевести `transport.ts` (`handle`, `sendError`,
      `HttpRequestValue`) на пару интерфейсов; проверить, что
      `IncomingMessage` и `ServerResponse` подходят без приведения типов
- [x] 1.6 Вынести `HttpAttach` (один метод `attach`) и сузить до него тип
      параметра конструктора `HttpTransport`; `HttpServer` его реализует
- [x] 1.7 `yarn workspace @nestlingjs/transport.http test` — прежние
      спеки зелёные без правок

## 2. Адаптер-транспорт

- [x] 2.1 Класс `HttpAdapter implements ITransport` в `src/adapter.ts`:
      композиция с `HttpTransport` поверх собственного приёмника
      обработчика, `serve`/`close` делегируются, геттер `node`
- [x] 2.2 Фабрика `adapter({ name?, …HttpTransportOptions })` —
      объявление без `server`, DI-токен `HttpTransport$(name)`,
      способности `HTTP_CAPABILITIES`
- [x] 2.3 Отказ геттера до `serve()` с названной причиной
- [x] 2.4 Спека: сборка с адаптером не открывает сокет и не заводит узел
      сервера; `adapter()` рядом с `http()` под одним именем отвергается
      контейнером; `adapter()` и `http()` объявляют одно значение
      способностей

## 3. Доступ к экземплярам и опция сигналов (`@nestlingjs/app`)

- [x] 3.1 Свойство `transports: ReadonlyMap<string, ITransport>` у
      `AssembledApp`: заполняется там же, где карта серверов, пусто до
      INIT
- [x] 3.2 Опция `run({ signals })` с умолчанием `true`; при `false`
      `#attachSignals` не вызывается
- [x] 3.3 Спеки: транспорт по имени после INIT, пустая карта до `run()`,
      неизменное число обработчиков `SIGTERM`/`SIGINT` при
      `run({ signals: false })`
- [x] 3.4 Барель и README `@nestlingjs/app`: новое свойство и опция

## 4. Форма `fetch`

- [x] 4.1 `FetchSource implements HttpSource`: `method`, `headers`, `url`
      как путь с query, поток из `Readable.fromWeb(request.body)`,
      пустой поток у запроса без тела, `socket` отсутствует
- [x] 4.2 `FetchSink implements HttpSink`: накопление заголовков, отдача
      `Response` на первом из `writeHead`/`flushHeaders`/`write`/`end`,
      тело потокового ответа — `ReadableStream`, `destroy()` рвёт поток
      ошибкой, `write` возвращает признак свободного места и зовёт
      колбэк после `enqueue`
- [x] 4.3 Разрыв соединения: `request.signal` хозяина взводит событие
      `'close'` приёмника
- [x] 4.4 Геттер `fetch` у `HttpAdapter` и `toFetchHandler(app, { name? })`;
      ожидание первым из двух — статус известен или `handle()`
      завершилась; завершилась без статуса — `404`
- [x] 4.5 `toNodeHandler(app, { name? })` с тремя отказами из спеки
      (приложение не запущено, имени нет, транспорт не адаптер)

## 5. Прогоны

- [x] 5.1 `adapter.integration.spec.ts`: одни декларации, три пути —
      сокет `http()`, node-форма, fetch-форма; ответы сравниваются
      целиком (статус, `content-type`, тело) на `GET`, `POST`, отказе
      проверки входа и объявленном `Fail`
- [x] 5.2 Потоки через fetch-форму: NDJSON до конца потока, SSE с
      heartbeat и `Last-Event-ID`, обрыв посреди потока
- [x] 5.3 `multipart` и `rawBody` через fetch-форму
- [x] 5.4 Непойманный маршрут: `false` у node-формы, `404` у fetch-формы
- [x] 5.5 Отмена: взвод `request.signal` доводит
      `ClientDisconnectedError` до сигнала контекста
- [x] 5.6 Отказы `toNodeHandler`/`toFetchHandler` — по одному прогону на
      каждую причину

## 6. Документация

- [x] 6.1 `docs/design/transports.md` §4: раздел про адаптер рядом с
      «Сервер как ресурс» — две формы работы пакета, где проходит общий
      байтовый путь, почему рантайм помимо Node вне границы
- [x] 6.2 Новый рецепт `docs/recipes/embedded.md`: приложение внутри
      чужого процесса — роут Next.js на fetch-форме, Express на
      node-форме, `run({ signals: false })`, `close()` хозяином, адрес
      клиента из заголовка
- [x] 6.3 `docs/recipes/README.md` — строка нового рецепта; сверить с
      `docs/recipes/standalone.md`, чтобы границы рецептов не
      пересекались
- [x] 6.4 `docs/glossary.md`: «адаптер-транспорт»
- [x] 6.5 README `@nestlingjs/transport.http`: раздел экспортов, пример
      встраивания, плашка статуса
- [x] 6.6 Английские пары всего перечисленного: `docs/en/design/
      transports.md`, `docs/en/recipes/embedded.md`,
      `docs/en/recipes/README.md`, `docs/en/glossary.md`,
      `packages/nestling.transport.http/README.md` и его русская пара
- [x] 6.7 `node .claude/skills/docs-style/scripts/lint.mjs` по всем
      правленым текстам — 0 запрещённых слов

## 7. Закрытие change'а

- [x] 7.1 Пометка «РЕАЛИЗОВАНО» в записи
      [ideas.md [2026-09-12]](../../../docs/decisions/ideas.md) «Разбор
      обзоров d/10 и d/13», пункт 4: что вышло целиком, что уехало
      дальше (рантайм помимо Node, HTTP-уровень в `testApp`), чем
      реализация уточнила решение
- [x] 7.2 Строка 79 roadmap — статус `done` со ссылкой на запись
- [x] 7.3 Оглавление `ideas.md`
      (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)

## 8. Definition of Done

- [ ] 8.1 Все задачи выше отмечены
- [ ] 8.2 `yarn verify` зелёный (build + typecheck + lint + test +
      type-budget по всем пакетам)
- [ ] 8.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 8.4 `design/` и `decisions/` синхронизированы по правилам
      CLAUDE.md; запись `ideas.md`, по которой шёл change, несёт пометку
      «РЕАЛИЗОВАНО»
- [ ] 8.5 `yarn docs:audit` — 0 ERROR
- [ ] 8.6 Затронутые `examples/*` мигрированы; главы гайда пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 8.7 `main` не тронут — слияние делает Merger после `/opsx:archive`
