## 1. Каркас пакета

- [x] 1.1 Создать `packages/nestling.subscriptions/` по образцу
      `packages/nestling.streams`: `package.json` (имя `@nestling/subscriptions`,
      `type: module`, exports `.`, скрипты `clear`/`build`/`lint`/`test`),
      `tsconfig.json`, `tsconfig.lint.json`, `eslint.config.js`,
      `jest.config.js` (реэкспорт `createJestConfig`)
- [x] 1.2 Зависимости пакета — ровно `@common/misc`, `@nestling/container`,
      `@nestling/operations`, `@nestling/pipeline`, `@nestling/streams`
      (`workspace:*`); внешних зависимостей и `@nestling/app` быть не должно.
      Проверить, что `yarn install` разложил workspace-ссылки и пакет
      собирается пустым `index.ts`
- [x] 1.3 `src/index.ts` — барель пакета с комментарием о границе: что
      экспортируется наружу (реестр, слой, модуль, типы, контракты) и что
      остаётся внутри (класс-юниты видны только модулю)

## 2. Модель подписки

- [x] 2.1 `src/types.ts`: `SubscriptionInfo` (`id`, `transport`, `pattern`,
      `kind`, `identity?`, `labels`, `startedAt` epoch ms, `itemsOut`),
      `SubscriptionFilter` (`transport?`, `pattern?`, `identity?`, `labels?`),
      `CloseReason = Outcome | 'killed'`, `SubscriptionEvent`
      (размеченное объединение `opened`/`closed`), `TrackedSubscription`
      (`id`, `signal`)
- [x] 2.2 `src/errors.ts`: `SubscriptionKilledError` — причина аборта,
      несущая `id` и текстовую причину; отличима от `ClientDisconnectedError`
      и `TransportClosingError` по классу и `name`
- [x] 2.3 Определить `kind` формы из `ctx.endpoint.output` через
      `isStreamKind`/`nameOfForm` из `@nestling/operations`; не-потоковая
      форма даёт `'value'`
- [x] 2.4 Тесты типов и рантайма для `CloseReason`: множество значений —
      ровно `Outcome` плюс `'killed'` (тест ловит расширение словаря ядра
      незамеченным)

## 3. Реестр

- [x] 3.1 `src/registry.ts`: класс `SubscriptionRegistry` с приватной картой
      записей `id → { ctx, controller, info-заготовка }` и приватным
      `Topic<SubscriptionEvent>`; конструктор принимает разрешённые опции и
      (опционально) эмиттеры фактов
- [x] 3.2 Внутренние `open(ctx): TrackedSubscription` и
      `close(id, outcome): void` — точки, которыми пользуется слой; `id`
      чеканится `crypto.randomUUID()` (тот же приём, что у `idempotencyKey`
      в `@nestling/ports`)
- [x] 3.3 `open` собирает административный `AbortController`, возвращает
      `{ id, signal: AbortSignal.any([ctx.signal, controller.signal]) }`,
      публикует `opened` в ленту
- [x] 3.4 `close` вычисляет `CloseReason` (взведён свой контроллер →
      `killed`, иначе — пришедший `Outcome`), публикует `closed`, снимает
      запись и **взводит** свой контроллер, если тот ещё не взведён, —
      композитный сигнал отвязывается от `ctx.signal` детерминированно
- [x] 3.5 `list(filter?)`, `get(id)`, `size`: снимок собирается заново на
      каждый вызов, `itemsOut` читается из `ctx.summary`, результат
      `Object.freeze`; фильтр — точное совпадение по `transport`/`pattern`/
      `identity` и подмножеству `labels`
- [x] 3.6 `abort(id, reason?)` → `boolean` и `abortAll(filter?)` → `number`:
      взводят контроллеры `SubscriptionKilledError`, запись **не** удаляют —
      её снимет `.finally`
- [x] 3.7 `watch(signal?)` — подписка на ленту; `@OnDestroy` закрывает
      `Topic`, чтобы наблюдатели завершались нормально
- [x] 3.8 Рантайм-тесты реестра (без пайплайна, на голом контексте-фикстуре):
      снимок заморожен и не мутируется; `itemsOut` актуален; фильтрация;
      `abort` несуществующего даёт `false`; `abortAll` возвращает число;
      причина закрытия для всех пяти значений `CloseReason`;
      `close()` ленты завершает наблюдателей без ошибки

## 4. Слой `tracked`

- [x] 4.1 `src/layer.ts`: `TrackSubscription` — `@Injectable([SubscriptionRegistry])`,
      `handle(ctx)` возвращает `{ subscription: registry.open(ctx) }`
- [x] 4.2 `UntrackSubscription` — `@Injectable([SubscriptionRegistry])`,
      `handle(outcome, _res, ctx)` читает `ctx.input.subscription?.id`
      (собственные поля слоя на ответном тракте — `Partial`) и зовёт
      `registry.close(id, outcome)`; отсутствие поля (регистрация не
      случилась) — тихий no-op
- [x] 4.3 `export const tracked = makePipeline().pre(TrackSubscription).finally(UntrackSubscription)`;
      проверить, что тип слоя даёт `TAcc = { subscription: TrackedSubscription }`
      и `TNeeds` содержит оба конструктора
- [x] 4.4 Рантайм-тесты слоя через `pipeline.executeWithHandler` с
      резолвером-заглушкой: запись появляется до вызова хендлера; снимается
      после `.finally`; для потоковой формы `output` снимается **после**
      того, как поток дотёк или закрыт потребителем; снимается и когда
      хендлер не выполнялся (отказ внутреннего pre)
- [x] 4.5 Тест комбинированного сигнала: итерация по
      `meta.subscription.signal` завершается и по взведению сигнала запроса,
      и по `registry.abort(id)`; `meta.signal` при `abort` остаётся
      невзведённым (гарантия `request-abort-signal` не нарушена)
- [x] 4.6 Тест «нет накопления»: 1 000 циклов «открыл — закрыл» оставляют
      реестр пустым, административные контроллеры взведены, число
      слушателей долгоживущего сигнала не растёт

## 5. Факты жизненного цикла контрактами

- [x] 5.1 `src/schema.ts`: приватный минимальный конструктор
      Standard-Schema-рекорда (`vendor: 'nestling'`) по образцу
      `packages/nestling.ports/src/config.ts` — ровно столько, сколько нужно
      двум объявлениям; комментарий, что это не библиотека схем
- [x] 5.2 `src/contracts.ts`: `event`-контракты `subscriptions.opened`
      (`node`, `id`, `transport`, `pattern`, `kind`, `identity?`,
      `startedAt`) и `subscriptions.closed` (`node`, `id`, `reason`,
      `itemsOut`, `closedAt`)
- [x] 5.3 Публикация в реестре: включается опцией, ошибка `emit` гасится и
      уходит в необязательный `onPublishError`; факт не вправе уронить
      подписку
- [x] 5.4 Тесты: при выключенной публикации эмиттеров в графе нет; при
      включённой и нулём подписчиков сборка проходит, `emit` — no-op;
      подписчик другой фичи получает оба факта; отказ `emit` не ломает
      открытие/закрытие подписки и виден в хуке

## 6. Модуль и композиция

- [x] 6.1 `src/module.ts`: `subscriptions(options?)` → `makeModule` из
      `@nestling/container` (не `makeAppModule`); провайдеры — фабрика
      реестра плюс оба класс-юнита; `exports: [SubscriptionRegistry]`
- [x] 6.2 `SubscriptionsOptions`: `identity?`, `labels?`, `feedBuffer?`,
      `publish?`, `node?`, `onPublishError?` — только решения композиции;
      `deps` фабрики собираются условно по `publish` (приём `invokerDeps`
      из `portsKernel`)
- [x] 6.3 Интеграционные тесты пакета на `assembleTest` из
      `@nestling/testing`: ручка с формой `events` и слоем `tracked`,
      вызов `app.call`, чтение потока, `registry.list()`/`abort()`;
      `await using` → SHUTDOWN снимает записи с причиной `aborted` и
      закрывает ленту
- [x] 6.4 Тест «слой без модуля»: ручка композирована от `tracked`, модуль
      не зарегистрирован → отказ на фазе ASSEMBLE (резолв класс-юнита), а не
      на первом запросе
- [x] 6.5 Тест идентичности модуля: два отдельных вызова `subscriptions({…})`
      в одном корне роняют сборку

## 7. Пример `examples.app-with-http`

- [x] 7.1 `src/infrastructure.ts`: `export const appSubscriptions = subscriptions({ … })`
      — один вызов на приложение, с `identity`-экстрактором и
      `publish: true`; подключить в `modules:` корня (`src/main.ts`)
- [x] 7.2 `modules/users/endpoints/activity-stream.endpoint.ts`: переезд на
      `meta.subscription.signal`, композиция `compose(noValidationPipeline, tracked, …)`;
      комментарий-пояснение, почему сигнал именно этот
- [x] 7.3 Админские ручки в `modules/ops/`: `GET /api/ops/subscriptions`
      (список со снимками), `DELETE /api/ops/subscriptions/:id` (kill,
      404-отказ `SubscriptionNotFound` при отсутствии),
      `GET /api/ops/subscriptions/live` (`events(SubscriptionEvent)` поверх
      `watch`, сама композирована от `tracked` — рекурсивный случай)
- [x] 7.4 Подписчик фактов в `modules/ops/`: `implement(SubscriptionOpened, { subscriber: 'ops', … })`
      — показывает, что наблюдение работает контрактом
- [x] 7.5 Обновить перечень ручек в выводе `main.ts` и e2e/интеграционные
      тесты примера: открыть SSE-подписку, увидеть её в списке, убить,
      убедиться, что поток закрылся и запись снята; живой просмотр
      не видит собственного `opened`
- [x] 7.6 Проверить, что политики корня (`hasLayer(observability)`,
      `hasVar(RequestId)`) выполняются новыми ручками и `yarn verify`
      примера зелёный

## 8. Инвариант «ядро не тронуто» и отчёт о замере

- [x] 8.1 Проверить и зафиксировать в сообщении коммита:
      `git diff --stat` по `packages/nestling.{pipeline,app,container,ports,contracts,streams,transport,transport.http,transport.cli,transport.nats,testing}`
      пуст за весь change
- [x] 8.2 Если по ходу реализации обнаружится место, где примитивов не
      хватает, — не править ядро, а дописать находку в отчёт (раздел 9) с
      вердиктом
- [x] 8.3 Сверить три известные находки с фактом реализации: №1
      (зарезервированный `signal`), №2 (`Outcome` без `killed`), №3
      (кластерное управление); уточнить формулировки по коду

## 9. Документация

- [x] 9.1 README пакета `@nestling/subscriptions`: назначение, плашка
      статуса со ссылкой на `docs/design/streaming.md`, публичный API,
      перечень зависимостей с объяснением, почему их именно столько,
      и раздел «Чего в пакете нет» (кластерный kill, история, метрики)
- [x] 9.2 `docs/decisions/ideas.md` — новая запись `[2026-08-01]` «Реестр
      подписок: результат dogfooding-замера»: контекст, три находки с
      вердиктами, положительные результаты, отвергнутые варианты
      (`request`-контракты админ-операций, расширение `ctx.signal`,
      расширение `Outcome`, `WeakMap` вместо поля input)
- [x] 9.3 `docs/decisions/ideas.md` — суперсид строки «(в будущем) кто
      угодно ещё — например, админский kill подписки» в записи
      `[2026-07-06]` со ссылкой на новую запись (append-only: помечаем, не
      переписываем)
- [x] 9.4 `docs/design/streaming.md`: правка §1 (админский канал — это
      `meta.subscription.signal` satellite'а, `meta.signal` остаётся
      транспортным и приложенческим) и новая секция «Реестр подписок»
      с целевым описанием пакета
- [x] 9.5 `docs/design/principles.md` — ссылка на пакет в перечне
      satellite'ов
- [x] 9.6 `docs/decisions/deferred.md` — запись про кластерную
      админ-плоскость (находка №3) с триггером возврата
- [x] 9.7 Новый гайд `docs/guides/subscriptions.md` (плашка «сверено с кодом
      `examples.app-with-http` (дата)»): подключение модуля, слой на ручке,
      правильный сигнал, админские ручки, живая лента, факты контрактами,
      квоты подписок как приложенческий pre-юнит поверх `list(filter)`
- [x] 9.8 Таблица гайдов в `docs/README.md` — строка нового гайда
- [x] 9.9 `README.md` корня: чекбокс `Subscriptions registry
      (@nestling/subscriptions)` и строка пакета в перечне
- [x] 9.10 `docs/decisions/roadmap.md`: статус #7 во всех трёх местах
      (таблица changes, ветка порядка, таблица волны 6) и абзац о закрытии
      волны 6 — с формулировкой результата замера

## 10. Definition of Done

- [x] 10.1 Все задачи выше отмечены
- [x] 10.2 `yarn verify` зелёный (build + lint + test по всем пакетам)
- [x] 10.3 README затронутых пакетов обновлены, включая плашки статуса
- [x] 10.4 `design/` и `decisions/` синхронизированы по правилам CLAUDE.md
- [x] 10.5 `yarn docs:audit` — 0 ERROR
- [x] 10.6 Затронутые `packages/examples.*` мигрированы, гайды пересверены
      с обновлённой датой в плашке «сверено с кодом»
- [x] 10.7 Коммиты осмысленные; **push не выполнен** — у окружения нет прав
      на `git@github.com:eonae/nestling.git` (`Please make sure you have the
      correct access rights`). Работа идёт в ветке `autorun/v1-all-waves`
      (все волны подряд), она готова к пушу
