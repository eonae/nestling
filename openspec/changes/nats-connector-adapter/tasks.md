# Задачи: nats-connector-adapter

## 1. Граница сообщения потока

- [x] 1.1 `NatsJsMsgLike` в `connector.ts` перестаёт наследовать
  `NatsMsgLike` и объявляет свой набор: `subject`, `data`, `headers`,
  `redeliveryCount`, `ack`, `nak`, `term`
- [x] 1.2 `JsMsgDouble` в `testing/double.ts` приводится к суженной
  границе: `respond` удаляется
- [x] 1.3 Тайпчек пакета зелёный, тесты на двойнике проходят

## 2. Адаптер к клиенту

- [x] 2.1 `defaultConnector` берёт `connect` и `headers` одним динамическим
  импортом, соединяется и передаёт соединение в `adapt`
- [x] 2.2 `adapt` собирает `NatsLike` полем за полем: `publish`, `request`,
  `subscribe`, `drain`, `closed` — прямыми вызовами клиента, `headers()` —
  функцией модуля
- [x] 2.3 `jetstreamManager()` оборачивается: `streams.add` и
  `streams.info` возвращают `info.config`, `consumers.add` переводит
  `ack_policy` в `AckPolicy.Explicit` и возвращает `info.config`
- [x] 2.4 `jetstream().subscribe(subject, { stream, durable })`
  исполняется через `js.consumers.get(stream, durable)` и `consume()`;
  генератор отдаёт `NatsJsMsgLike` с `redeliveryCount` из
  `info.redeliveryCount`
- [x] 2.5 Приведений через `unknown` и `any` в `connector.ts` не осталось;
  тайпчек пакета зелёный

## 3. Прогон против живого брокера

- [x] 3.1 `compose.yaml` в корне: служба `nats`, образ `nats:2`, команда
  `-js`, порт 4222
- [x] 3.2 `scripts/test-live.mjs`: поднимает службу, ждёт порт 4222 с
  потолком ожидания, прогоняет тесты пакета с `NATS_TEST_SERVERS`,
  останавливает службу, возвращает код прогона
- [x] 3.3 Корневой скрипт `test:live` в `package.json`
- [x] 3.4 `yarn test:live` зелёный: семь сценариев
  `live.integration.spec.ts` проходят против живого брокера
- [x] 3.5 Остановка транспорта при живой durable-подписке не оставляет
  процесс висеть; если `consume()` требует явного закрытия, граница
  `subscribe` получает возвращаемый тип с `close()`, а `close()`
  транспорта — его вызов

## 4. Зависимость на клиента

- [x] 4.1 `nats` переезжает в `peerDependencies` и `devDependencies`
  пакета
- [x] 4.2 `yarn pack:check` зелёный

## 5. Документация

- [x] 5.1 README пакета (`README.md` и `README.ru.md`) называет команду
  живого прогона и границу двойника
- [x] 5.2 `RELEASING.md`: шаг живого прогона в разделе «Выпуск» до подъёма
  версии
- [x] 5.3 Запись `ideas.md` [2026-09-12] «Коннектор к живому клиенту
  `nats`» получает пометку «РЕАЛИЗОВАНО» с тем, что вышло, и с уточнением
  решения: подписка идёт упрощённым API потребителей, а не через
  `consumerOpts()`
- [ ] 5.4 Строка 75 в `roadmap.md` переведена в `done` — **шаг архива**:
  колонка статуса ссылается на каталог `openspec/changes/archive/`, который
  создаёт `/opsx:archive`, и до него ссылка битая (`docs:audit` →
  `broken-link`). Порядок — по `CLAUDE.md`: строка roadmap'а правится после
  архивации. Описание change'а в строке уже приведено к тому, что вышло
- [x] 5.5 Оглавление `ideas.md` обновлено
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [x] 5.6 Тексты правок прогнаны линтером стиля
  (`node .claude/skills/docs-style/scripts/lint.mjs <пути>`) — 0
  запрещённых слов

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены — кроме 5.4: строка roadmap'а
  переводится в `done` после `/opsx:archive`, иначе ссылка на архив битая
- [x] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [x] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 6.4 `design/` и `decisions/` синхронизированы по правилам
  `CLAUDE.md`, запись `ideas.md` несёт пометку «РЕАЛИЗОВАНО» с тем, что
  вышло целиком, что уехало дальше и чем реализация уточнила решение
- [x] 6.5 `yarn docs:audit` — 0 ERROR
- [x] 6.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [x] 6.7 Коммиты осмысленные, `main` не тронут: слияние делает Merger
  после `/opsx:archive`
