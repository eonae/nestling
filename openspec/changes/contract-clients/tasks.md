## 1. Примитив токена доступен листом

- [x] 1.1 Добавить в `@nestling/container` subpath-экспорт `./tokens`
      (`src/common.ts` + `src/providers/token-family.ts`) — `exports` в
      `package.json`, точка входа `src/tokens.ts`, пути в tsconfig
      (в репозитории нет `paths` — резолв идёт через `exports`; добавлен
      маппинг subpath'а в `jest.config.base.js`)
- [x] 1.2 Убедиться, что оба модуля остаются листьями (только `import type`
      наружу); поверхность бареля `@nestling/container` не меняется
- [x] 1.3 `yarn verify` — зелёный

## 2. Каркас `@nestling/contracts`

- [x] 2.1 Завести `packages/nestling.contracts` по образцу существующих
      пакетов (package.json, tsconfig, jest, README-заготовка); зависимости —
      `@common/misc`, `@nestling/streams`, `@nestling/container` (subpath)
- [x] 2.2 Написать тест границы пакета: обход графа импортов собранного
      `dist/`, белый список (`@common/misc`, `@nestling/streams`,
      `@nestling/container/tokens`, `@standard-schema/spec`), запрет `node:*`
      и главных экспортов серверных пакетов; тест падает с именем модуля и
      запрещённого импорта
- [x] 2.3 Прогнать тест на пустом пакете — убедиться, что он реально ловит
      подсаженный запрещённый импорт (закреплено вторым кейсом
      `boundary.spec.ts` на синтетической фикстуре — регрессия, а не разовая
      проверка)

## 3. Переезд декларативного слоя (по одному листу, с реэкспортом)

- [x] 3.1 Перенести `core/status.ts` и `core/result.ts` (`Ok`, `Fail`,
      `isFail`, `FailData`); `@nestling/pipeline` реэкспортирует; `yarn verify`
- [x] 3.2 Перенести `core/define-fail.ts`; перегрузку `is(ResponseContext)`
      объявить над минимальным структурным типом
      (`{ isSuccess: false; value?: { code?: string } }`), проверив, что
      сужение в `.catch`-юнитах не потерялось; реэкспорт; `yarn verify`
- [x] 3.3 Перенести `core/kernel-fails.ts` (включая `UnknownError`,
      `ValidationFailed`, `DeadlineExceeded` и `isKernelFailCode`); реэкспорт;
      `yarn verify`
- [x] 3.4 Перенести декларативный слой `core/io/` (`forms`, `io`, `summary`,
      `assert`, `capabilities`); `bind-stream.ts` остаётся в
      `@nestling/pipeline`; реэкспорт; `yarn verify`
- [x] 3.5 Перенести из `@nestling/transport.http` декларативную половину
      `binding.ts` — `BindMark`, `query()`, `body()`, `isBindMark`,
      `HttpBinding`, `readPathParams`, `computeHttpBinding`, `isHttpBinding`;
      заменить тип `HTTPMethod` из `find-my-way` на локальный строковый союз;
      потребляющая половина (`assemblePayload`, `readQuery`,
      `bindingNeedsBody`, `httpBindingOf`) остаётся; реэкспорт; `yarn verify`
- [x] 3.6 Перенести из `@nestling/ports` `contract.ts`, `registry.ts` и
      семейства вызывателей (`PortFamily`/`EmitterFamily` и типы
      `Port`/`Emitter`/`PortMeta`/`CommandMeta`, которые от них неотделимы);
      `@nestling/ports` импортирует их из `@nestling/contracts` и **не**
      реэкспортирует `makeContract`; `yarn verify`
- [x] 3.7 Прогнать тест границы пакета (2.2) — замыкание чистое
- [x] 3.8 Проверить, что перенесённые тесты переехали вместе с модулями и
      покрытие не потерялось (`define-fail.spec`, `result.spec`,
      `forms.spec`, `binding.spec`, `contract.spec`)

## 4. Секция `http:` в контракте

- [x] 4.1 Добавить в `ContractSpec` поле `http` в двух формах (строка и
      запись); строгий разбор строковой формы с fail-fast
- [x] 4.2 Вызвать `computeHttpBinding` в `makeContract`, положить карту на
      значение контракта; типизировать ключи `bind` полями `input` за вычетом
      path-параметров (как в HTTP-словаре)
- [x] 4.3 Рантайм-тесты fail-fast: битая строковая форма, пустой путь и путь
      без `/`, повторяющийся path-параметр, пометка на path-параметре,
      `body()` у метода без тела, `bind`/path-параметр при неструктурном
      `input`, path-параметр без `input`, `rawBody` с потоковой формой,
      `sse` при не-`events`-выходе; текст ошибки называет контракт
- [x] 4.4 Тест «карта контракта структурно совпадает с картой одноимённой
      HTTP-декларации» на общем наборе случаев
- [x] 4.5 Тесты «`http:` ничего не меняет»: вид, `.port`/`.emitter`,
      `implement` и вызов по шине работают как прежде

## 5. Контракт-форма `httpEndpoint`

- [x] 5.1 Добавить перегрузки `httpEndpoint({ contract, … })` для трёх форм
      `handle`; поля интерфейса операции объявить `never`
- [x] 5.2 Брать карту, схемы и `errors:` с контракта; карту не пересчитывать
- [x] 5.3 Fail-fast: контракт без `http:` — ошибка в момент создания
      декларации с текстом, называющим контракт и предлагающим `implement`
- [x] 5.4 Рантайм-тесты: маршрут поднимается и обслуживает запрос; отказ из
      `errors:` контракта доезжает кодом; dispatch, политики и визуализация
      видят обычную декларацию
- [x] 5.5 Type-тесты: переобъявление `input`/`path`/`errors` не компилируется

## 6. Пакет `@nestling/client`

- [x] 6.1 Завести `packages/nestling.client` (зависимость — только
      `@nestling/contracts`); подключить тест границы пакета
- [x] 6.2 Реализовать `makeClient(record, config)`: типы API-объекта, вывод
      call-site по виду контракта (`request` → `Ok|Fail`, `command` →
      `Promise<void>`)
- [x] 6.3 Fail-fast создания: контракт без `http:`, вид `event`, потоковая/
      multipart-форма io, неабсолютный `baseUrl` — с указанием ключа метода
- [x] 6.4 Сборка запроса по bind-карте: подстановка path-параметров с
      `encodeURIComponent`, query, тело, склейка `baseUrl` + путь,
      `Content-Type` только при наличии тела
- [x] 6.5 Коерсия query: пропуск `undefined`/`null`, `String(...)` для
      скаляров, повторяющиеся ключи для массивов скаляров, `TypeError` с
      именем поля на всём остальном
- [x] 6.6 Разбор успеха: HTTP-код → `SuccessStatus`, `204` → `Ok('NO_CONTENT',
      null)`, валидация по `output` через `~standard.validate` по умолчанию,
      синхронность обязательна, opt-out `validateOutput: false`
- [x] 6.7 Разбор отказа: тело `{ error, code?, details? }`, рематериализация
      по `code` из `errors:` (статус из определения, детали валидируются его
      схемой), иначе `UnknownError` с оригиналом в `cause`
- [x] 6.8 `meta`: `signal` в `fetch`, `deadline` — проверка до отправки
      (`DeadlineExceeded` без похода в сеть) и композиция в `AbortSignal`
- [x] 6.9 Ambient-заголовки: запись и функция (в том числе асинхронная),
      вызываемая на каждый запрос; подменяемый `fetch`
- [x] 6.10 Клиент не бросает на сетевых и контрактных сбоях у `request` —
      возвращает `Fail`; тесты на каждый путь (сеть, не-JSON, отмена,
      невалидный ответ, незадекларированный код, несошедшиеся детали)
- [x] 6.11 Type-тесты: результат метода — ровно `Ok<Output> | Fail<E ∪
      UnknownError>`; `EmailTaken.is(result)` сужает детали

## 7. Round-trip и интеграция

- [x] 7.1 Round-trip-тест «клиент собрал → транспорт разобрал по той же
      карте → payload равен исходному» на наборе карт: path-параметры,
      пометки, `rest: query`/`body`, `query({ multiple: true })` с одним
      вхождением
- [x] 7.2 Интеграционный тест: поднятое приложение с контракт-формой
      `httpEndpoint` + реальный `makeClient` — успех, задекларированный отказ,
      незадекларированный отказ, отмена по `signal`
- [x] 7.3 Проверить, что тесты границы пакетов (2.2, 6.1) зелёные после всей
      реализации

## 8. Примеры и документация

- [x] 8.1 `packages/examples.app-with-http`: контракты обзаводятся `http:`,
      реализация переводится на контракт-форму `httpEndpoint`, добавляется
      клиентский скрипт-потребитель, импортирующий только контракты и клиент
- [x] 8.2 `packages/examples.split-nats`: импорт `makeContract` переводится на
      `@nestling/contracts`
- [ ] 8.3 Новый гайд `docs/guides/typed-client.md`, сверенный с примером;
      плашка «сверено с кодом» с датой
- [ ] 8.4 `docs/guides/ports.md` и `docs/guides/http-*.md` — обновить импорты
      и пересверить плашки с датой
- [ ] 8.5 `docs/design/contracts.md` — секция `http:`, внешний потребитель,
      контракт-форма `httpEndpoint`, пакетная граница
- [ ] 8.6 `docs/design/errors.md` — рематериализация отказа по проводу и
      закрытый контракт `E ∪ UnknownError` на клиенте
- [ ] 8.7 `docs/design/schemas.md` — валидация ответа клиентом через
      `~standard.validate`
- [ ] 8.8 `docs/decisions/ideas.md` — запись с решениями change'а: пакетная
      граница и subpath токенов, контракт-форма `httpEndpoint`, валидация
      ответа по умолчанию, правила коерсии query, отвергнутые варианты;
      закрыть в записи [2026-07-13] два открытых вопроса пометкой «РЕШЕНО»
- [ ] 8.9 `docs/decisions/deferred.md` — `idempotencyKey`/`deadline` по HTTP,
      content-negotiation; триггеры возврата
- [ ] 8.10 README пакетов: новые `@nestling/contracts` и `@nestling/client`
      (включая предупреждение о двух копиях пакета в одном приложении),
      обновление плашек статуса у `@nestling/pipeline`, `@nestling/ports`,
      `@nestling/transport.http`, `@nestling/container`

## 9. Definition of Done

- [ ] 9.1 Все задачи `tasks.md` отмечены
- [ ] 9.2 `yarn verify` зелёный (`build` + `lint` + `test` по всем пакетам)
- [ ] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 9.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [ ] 9.5 `yarn docs:audit` — 0 ERROR
- [ ] 9.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
      обновлённой датой в плашке «сверено с кодом»
- [ ] 9.7 Коммиты осмысленные, ветка запушена
- [ ] 9.8 Обновить статус change #22 в `docs/decisions/roadmap.md`
