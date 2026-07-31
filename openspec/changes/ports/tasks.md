# tasks — ports

Порядок ступенчатый: каждая ступень проверяема отдельно и оставляет
репозиторий в зелёном состоянии (`yarn verify`).

## 1. Пакет `@nestling/ports`

- [x] 1.1 Создать пакет `packages/nestling.ports` по образцу
  `packages/nestling.config` (package.json, tsconfig, jest, `src/index.ts`,
  README-заготовка с плашкой статуса); зависимости — `@nestling/container`,
  `@nestling/pipeline`, `@nestling/transport`, `@nestling/streams`,
  `@nestling/config`, `@common/misc`
- [x] 1.2 Подключить пакет в корневые `tsconfig.base.json` (paths), workspace
  и убедиться, что `yarn verify` видит новый проект

## 2. Контракт как значение

- [x] 2.1 `makeContract({ name, kind, input?, output?, errors? })`: тип
  `Contract`, вывод `InputOf`/`OutputOf`/`FailsOf`, заморозка значения
- [x] 2.2 Fail-fast словаря в точке создания: пустое имя, вид вне
  `request|command|event`, `errors:` не из `defineFail`, дублирующийся `code`
- [x] 2.3 Приватный реестр «имя → контракт» с ошибкой на занятое имя (текст
  называет имя и объясняет, что имя — адрес); реестр не экспортируется
- [x] 2.4 Семейства `Port`/`Emitter` (`makeTokenFamily`) и свойства
  `.port`/`.emitter`, доступные по виду контракта: тип-уровень (свойства нет
  у неподходящего вида) + рантайм-ошибка для JS-потребителей
- [x] 2.5 Типы вызывателей `Port<C>` / `Emitter<C>` и `PortMeta` (`signal`,
  форма открыта под `deadline`/`idempotencyKey` из #27)
- [x] 2.6 Рантайм-тесты: объявление трёх видов, все fail-fast'ы, дубль имени,
  идентичность токенов `.port`/`.emitter` при повторном обращении

## 3. Реализация контракта — обычная декларация

- [x] 3.1 Токен транспорта шины (`transport:bus`) и типизированный биндинг
  `{ subject, kind, subscriber? }` с читалкой (`busBindingOf`)
- [x] 3.2 `implement(Contract, { deps?, pipeline?, handle, subscriber?, detached? })`
  поверх `makeEndpoint`: `input`/`output`/`errors` берутся из контракта,
  переобъявление — ошибка компиляции
- [x] 3.3 Правило паттернов: `<name>` для `request`/`command`,
  `<name>@<subscriber>` для `event`; `subscriber:` обязателен у `event` и
  запрещён у остальных (fail-fast с именем контракта и видом)
- [x] 3.4 Рантайм-тесты: три формы `handle`, `resolve`, участие в
  `discoverEndpoints`, бренд декларации, `detached`

## 4. Шина

- [x] 4.1 Интерфейс `IMessageBus` (`request`/`publish`/`subscribe` + группа
  доставки) и токен `MessageBus$`
- [x] 4.2 `InProcessBus`: `IMessageBus` + `ITransport` (`serve(dispatch,
  signal)` подписывается на subject'ы своих маршрутов, `close()` и взвод
  сигнала прекращают доставку); broadcast поверх `Topic` из
  `@nestling/streams`
- [x] 4.3 `capabilities` шины — только `value` для входа и выхода;
  прогон существующей `assertFormsSupported` на декларации со `stream`/`events`
- [x] 4.4 Sim-режим провода: async-барьер, структурная копия payload/ответа,
  внятный отказ на несериализуемом значении
- [x] 4.5 Рантайм-тесты: доставка `command` ровно одному, `event` — всем,
  изоляция отказа подписчика, отсутствие доставки после shutdown, медленный
  подписчик

## 5. Вызыватели и нормализация ответа

- [x] 5.1 Общий нормализатор `ResponseContext → Ok | Fail`: ре-гидрация по
  `code` через определения `errors:` контракта, `UnknownError` для
  незадекларированного, `exposeErrorDetails: false`
- [x] 5.2 Local-клиент: сборка контекста запроса, вызов `dispatch.call`,
  собственный request-scope, без копирования payload и без повторной
  валидации ответа
- [x] 5.3 Remote-клиент: `request`/`publish` через `IMessageBus`, структурная
  копия, валидация ответа по `output`-схеме контракта
- [x] 5.4 `emit`: `Promise<void>` по факту доставки, изоляция отказов
  подписчиков, диагностический хук для необработанного отказа
- [x] 5.5 Рантайм-тесты на оба пути: успех, объявленный отказ, незадекларированный
  отказ, отмена по `meta.signal`, невалидный вход

## 6. Kernel-модуль и биндинг

- [x] 6.1 Kernel-секция конфига `nestlingPorts` с полем `dispatch`
  (`local-first` по умолчанию, `always-remote`; неизвестное значение —
  ошибка валидации секции)
- [x] 6.2 `collectImplementations(discovery)` — топология «subject → вид,
  подписчики, модули»; fail-fast на двух владельцах `request`/`command` и на
  двух одинаковых `subscriber` у `event`
- [x] 6.3 `PortRuntime` — держатель исполнителя local-биндинга и
  `bindPorts(container, dispatches)` для фазы WIRE; вызов до связывания —
  ошибка с именем контракта и фазой
- [x] 6.4 `portsKernel({ implementations })`: рецепты семейств `Port`/`Emitter`,
  регистрация `InProcessBus` под токеном транспорта и `MessageBus$`,
  регистрация держателя
- [x] 6.5 Fail-fast «нет co-located реализации» для `request`/`command` при
  материализации вызывателя (текст называет контракт, вид и потребителя);
  `event` — исключение
- [x] 6.6 Рантайм-тесты: материализация только запрошенных контрактов,
  выбор пути по политике, ошибка недостижимого контракта, ошибка вызова до WIRE

## 7. Интеграция в `App`

- [x] 7.1 Перенести вызов `discoverEndpoints` выше регистрации модулей и
  регистрировать `portsKernel({ implementations })` рядом с
  `configKernel`/`contextKernel`
- [x] 7.2 Шаг связывания портов в фазе WIRE — после `makeDispatch`, до START
  (и на тестовом шве тоже)
- [x] 7.3 Проверить, что приложение без контрактов не меняет ни состав графа,
  ни отчёт `check()`, ни строку состава на старте
- [x] 7.4 Тесты в `@nestling/app`: сборка двух фич с контрактом, `select`
  без реализации, обе политики диспатча через `vars()` в тестовом корне

## 8. Примеры, гайды, документация

- [x] 8.1 Витрина в `packages/examples.app-with-http`: две фичи, общающиеся
  `request`-контрактом и `event`-контрактом; переключение политики
  переменной окружения без правки call-site
- [x] 8.2 Новый гайд `docs/guides/ports.md`, сверенный с кодом примера
  (плашка «сверено с кодом <пример> (дата)»)
- [x] 8.3 Уточнить `docs/design/contracts.md` по факту реализованного (форма
  `implement`, `subscriber`, шаг WIRE, состав V1-политик) и
  `docs/design/composition.md`/`transports.md` там, где появляется шина
- [x] 8.4 Запись в `docs/decisions/ideas.md` о принятых здесь решениях
  (адрес подписки, политика как конфиг, sim-режим, `emit: Promise<void>`) —
  с логикой и отвергнутыми вариантами
- [x] 8.5 README нового пакета и `@nestling/app`; статус change #11 в
  `docs/decisions/roadmap.md`

## 9. Definition of Done

- [x] 9.1 Все задачи выше отмечены
- [x] 9.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [x] 9.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 9.4 `design/` и `decisions/` синхронизированы по правилам `CLAUDE.md`
- [x] 9.5 `yarn docs:audit` — 0 ERROR
- [x] 9.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 9.7 Коммиты осмысленные, ветка `change/ports` запушена
