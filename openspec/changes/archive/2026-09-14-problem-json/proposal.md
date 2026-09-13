# problem-json

## Why

Тело отказа HTTP-границы — формат собственного сочинения:
`{ error, code, details? }` под медиатипом `application/json`. Потребитель
на чужом стеке разбирает его по нашей документации, хотя на эту задачу
есть стандарт: RFC 9457, медиатип `application/problem+json`. Тема
отложена записью [deferred.md [2026-07-14]](../../../docs/decisions/deferred.md)
«Wire-формат ошибок: RFC 9457» с двумя триггерами возврата; оба
сработали — `error-model` реализован, а у ошибок появились внешние
читатели (типизированный клиент и документ OpenAPI). Строка 83
[roadmap](../../../docs/decisions/roadmap.md).

Вторая причина — внутри пакета. Отказ уходит клиенту тремя разными
телами: ответ пайплайна (`{ error, code, details?, stack? }`), ошибка до
пайплайна (`{ error, code, details }`) и кадр `event: error` у SSE
(`{ error, code? }`). Один формат вместо трёх — уменьшение поверхности
независимо от стандарта.

## What Changes

- **BREAKING** HTTP-граница отвечает на отказ документом RFC 9457 под
  медиатипом `application/problem+json`. Поля: `type`, `title`, `status`,
  `detail` и расширения `details`, `stack`.
- **BREAKING** Идентичность отказа едет в `type` значением
  `urn:error:<код>` (`urn:error:not_found:user`). Поля `code` в теле
  больше нет: по RFC 9457 первичный идентификатор типа проблемы —
  именно `type`, и чужой потребитель читает его штатным полем своего
  типа проблемы, а не разбором расширения.
- `title` — фраза статуса HTTP по категории отказа (`Not Found`),
  `detail` — сообщение отказа, `status` — код HTTP числом, `details` —
  детали отказа по схеме определения, `stack` — только при
  `exposeErrorDetails`.
- Три места сериализации сводятся к одной функции пакета
  `transport.http`: ответ пайплайна, ошибка до пайплайна (битый JSON,
  превышенный лимит, внутренняя ошибка) и кадр `event: error` у SSE.
  Кадр SSE несёт тот же документ.
- **BREAKING** Типизированный клиент читает документ: код отказа
  восстанавливается из `type`, сообщение — из `detail`, детали — из
  `details` по схеме определения. Тела прежней формы клиент не понимает.
- **BREAKING** Генератор OpenAPI описывает отказы медиатипом
  `application/problem+json` и схемой документа: `type` константой,
  `title`, `status` константой, `detail` и `details`.
- Модуль формата живёт в `@nestlingjs/operations` рядом с bind-картой
  HTTP и реэкспортируется транспортом: типизированный клиент читает
  документ, не завися от серверного пакета.

## Capabilities

### New Capabilities

- `http-problem-details`: формат тела отказа HTTP-границы — документ
  RFC 9457, отображение полей отказа на его члены, идентичность
  `urn:error:<код>`, один формат на все три места сериализации.

### Modified Capabilities

- `error-response-safety`: требования цитируют тела ответов; generic-500
  становится problem-документом, раскрытие `stack` — его расширением.
- `http-request-validation-errors`: ответ `400` несёт
  `type: "urn:error:bad_request"` вместо поля `code`; форма `details`
  (issue'ы Standard Schema) сохраняется.
- `http-transport-limits`: ответ `413` на превышение `maxBodySize` —
  problem-документ.
- `http-streaming-framing`: кадр `event: error` несёт problem-документ
  вместо `{ error, code? }`.
- `typed-http-client`: клиент восстанавливает отказ из problem-документа.
- `openapi-document`: ответы отказов описываются медиатипом
  `application/problem+json` и схемой problem-документа.

## Non-goals

- Формат отказа у транспортов NATS, CLI и MCP. Problem-документ — концерн
  HTTP: шина и протокол MCP сериализуют отказ по-своему, и `ErrorDetails`
  остаётся их формой.
- Изменение модели ошибок ядра. `Fail`, `makeFail`, коды, категории,
  `ErrorDetails` контекста ответа и таблица `httpCodeOf` остаются как
  есть: меняется только сериализация на границе HTTP.
- Член `instance` и корреляция запроса в теле отказа. `RequestId` ставит
  штатный юнит наблюдаемости, до `sendResponse` значение не доходит, и
  проводка стоит дороже пользы; тема отдельной записи.
- Настраиваемая база URI у `type` и ссылки на документацию сервиса.
  Форма фиксированная, настраивать нечего.
- Заголовок типа отказа полем декларации (`makeFail('…', { title })`).
  `title` выводится из категории; расширение публичного API ядра — не
  эта работа.
- Переименования из change'ей 86 `terminology` и 87 `naming-conventions`.
  Change пишется поверх текущих имён.

## Impact

Код:

- `@nestlingjs/operations`: новый модуль формата `src/http/problem.ts`
  (документ, медиатип, префикс типа, сборка и разбор), экспорты пакета.
- `@nestlingjs/transport.http`: `src/adapter.ts` (`sendResponse`,
  `midStreamBody`), `src/transport.ts` (`sendError`), `src/index.ts`
  (реэкспорт формата), интеграционные спеки пакета.
- `@nestlingjs/client`: `src/response.ts` (`readFailure`), спеки пакета.
- `@nestlingjs/openapi`: `src/responses.ts` (`failSchema`,
  `jsonResponse`), `src/document.spec.ts`.

Документация: `docs/design/errors.md` (раздел о проводном формате),
`docs/design/transports.md` §4 (строки об ответе и потоке),
`docs/guide/04-errors.md`, `03-input.md`, `10-auth.md`,
`12-files-and-streams.md`, `14-features.md`, `docs/recipes/ops.md`,
`docs/recipes/webhook.md` — вместе с английскими парами в `docs/en/`.
README пакетов `operations`, `transport.http`, `client` и `openapi`
с парами `README.ru.md`.

Примеры: e2e-проверки тел отказа в `examples/*` и снимки документа
OpenAPI.
