# Задачи: nats-connector-adapter

## 1. Граница сообщения потока

- [ ] 1.1 `NatsJsMsgLike` в `connector.ts` перестаёт наследовать
  `NatsMsgLike` и объявляет свой набор: `subject`, `data`, `headers`,
  `redeliveryCount`, `ack`, `nak`, `term`
- [ ] 1.2 `JsMsgDouble` в `testing/double.ts` приводится к суженной
  границе: `respond` удаляется
- [ ] 1.3 Тайпчек пакета зелёный, тесты на двойнике проходят

## 2. Адаптер к клиенту

- [ ] 2.1 `defaultConnector` берёт `connect` и `headers` одним динамическим
  импортом, соединяется и передаёт соединение в `adapt`
- [ ] 2.2 `adapt` собирает `NatsLike` полем за полем: `publish`, `request`,
  `subscribe`, `drain`, `closed` — прямыми вызовами клиента, `headers()` —
  функцией модуля
- [ ] 2.3 `jetstreamManager()` оборачивается: `streams.add` и
  `streams.info` возвращают `info.config`, `consumers.add` переводит
  `ack_policy` в `AckPolicy.Explicit` и возвращает `info.config`
- [ ] 2.4 `jetstream().subscribe(subject, { stream, durable })`
  исполняется через `js.consumers.get(stream, durable)` и `consume()`;
  генератор отдаёт `NatsJsMsgLike` с `redeliveryCount` из
  `info.redeliveryCount`
- [ ] 2.5 Приведений через `unknown` и `any` в `connector.ts` не осталось;
  тайпчек пакета зелёный

## 3. Прогон против живого брокера

- [ ] 3.1 `compose.yaml` в корне: служба `nats`, образ `nats:2`, команда
  `-js`, порт 4222
- [ ] 3.2 `scripts/test-live.mjs`: поднимает службу, ждёт порт 4222 с
  потолком ожидания, прогоняет тесты пакета с `NATS_TEST_SERVERS`,
  останавливает службу, возвращает код прогона
- [ ] 3.3 Корневой скрипт `test:live` в `package.json`
- [ ] 3.4 `yarn test:live` зелёный: семь сценариев
  `live.integration.spec.ts` проходят против живого брокера
- [ ] 3.5 Остановка транспорта при живой durable-подписке не оставляет
  процесс висеть; если `consume()` требует явного закрытия, граница
  `subscribe` получает возвращаемый тип с `close()`, а `close()`
  транспорта — его вызов

## 4. Зависимость на клиента

- [ ] 4.1 `nats` переезжает в `peerDependencies` и `devDependencies`
  пакета
- [ ] 4.2 `yarn pack:check` зелёный

## 5. Документация

- [ ] 5.1 README пакета (`README.md` и `README.ru.md`) называет команду
  живого прогона и границу двойника
- [ ] 5.2 `RELEASING.md`: шаг живого прогона в разделе «Выпуск» до подъёма
  версии
- [ ] 5.3 Запись `ideas.md` [2026-09-12] «Коннектор к живому клиенту
  `nats`» получает пометку «РЕАЛИЗОВАНО» с тем, что вышло, и с уточнением
  решения: подписка идёт упрощённым API потребителей, а не через
  `consumerOpts()`
- [ ] 5.4 Строка 75 в `roadmap.md` переведена в `done`
- [ ] 5.5 Оглавление `ideas.md` обновлено
  (`node .claude/skills/docs-audit/scripts/ideas-toc.mjs`)
- [ ] 5.6 Тексты правок прогнаны линтером стиля
  (`node .claude/skills/docs-style/scripts/lint.mjs <пути>`) — 0
  запрещённых слов

## 6. Definition of Done

- [ ] 6.1 Все задачи выше отмечены
- [ ] 6.2 `yarn verify` зелёный (`build` + `typecheck` + `lint` + `test` +
  `type-budget` по всем пакетам)
- [ ] 6.3 README затронутых пакетов обновлены, включая плашки статуса
- [ ] 6.4 `design/` и `decisions/` синхронизированы по правилам
  `CLAUDE.md`, запись `ideas.md` несёт пометку «РЕАЛИЗОВАНО» с тем, что
  вышло целиком, что уехало дальше и чем реализация уточнила решение
- [ ] 6.5 `yarn docs:audit` — 0 ERROR
- [ ] 6.6 Затронутые `examples/*` мигрированы, главы гайда пересверены с
  обновлённой датой в плашке «сверено с кодом»
- [ ] 6.7 Коммиты осмысленные, `main` не тронут: слияние делает Merger
  после `/opsx:archive`
