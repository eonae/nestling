# Документация Nestling

Правило номер один: **папка определяет статус документа**. Если док лежит
в `design/` — это целевое состояние V1, которому можно верить; если в
`history/` — это археология, читать только для контекста.

## Карта

```
docs/
├── design/        ← ЦЕЛЕВОЕ СОСТОЯНИЕ V1. Полное описание API, без порядка работ.
├── decisions/     ← журнал решений: когда, что, почему, отвергнутые варианты.
├── guides/        ← гайды по ТЕКУЩЕМУ API, сверены с кодом примеров.
├── preview/       ← статический HTML-превью документации; не источник истины.
└── history/       ← замороженная история. Не редактируется.
    ├── discussions/   — дискуссии, из которых рождались решения
    ├── migrations/    — гайды миграций прошлых ломающих изменений
    ├── superseded/    — дизайны, замещённые более новыми решениями
    └── worklog/       — рабочие заметки времён реализации
```

Актуальное состояние **кода** документируют README пакетов
(`packages/*/README.md`) — они публикуются с npm и живут рядом с кодом.
В пакете держим только то, что нужно его пользователю сегодня.
**У примеров README нет намеренно**: их роль выполняют гайды в `guides/`,
а запускаемая правда — сам код `packages/examples.*`.

## guides/ — по текущему API

| Гайд | О чём | Пример-источник |
|---|---|---|
| [http-functional.md](./guides/http-functional.md) | HTTP без DI: `httpEndpoint`, валидация, стриминг | `examples.simple-http-server` |
| [http-app-di.md](./guides/http-app-di.md) | `assemble`, модули, `deps`/класс-хендлер, `Ok`/`Fail` | `examples.app-with-http` |
| [composition.md](./guides/composition.md) | Composition root: `assemble`, фичи и `select`, фазы, `@OnStart`, standalone | `examples.app-with-http` |
| [di-token-families.md](./guides/di-token-families.md) | Семейства токенов: `makeTokenFamily`, `familyProvider`, `.auto`, `strictExports` | `examples.simple-app` |
| [config.md](./guides/config.md) | Конфиг: `makeConfig`, `.keys`, источники и привязка, fail-fast, reloadable | `examples.simple-app` |
| [ports.md](./guides/ports.md) | Порты: `makeContract`, `implement`, `.port`/`.emitter`, политика диспатча, шина | `examples.app-with-http` |
| [typed-client.md](./guides/typed-client.md) | Внешний потребитель: секция `http:`, контракт-форма `httpEndpoint`, `makeClient` | `examples.app-with-http` |
| [openapi.md](./guides/openapi.md) | Документ OpenAPI 3.1 из деклараций: модуль `openapi()`, слот `doc:`, конвертеры, `jsonSchema()` | `examples.app-with-http` |
| [cli.md](./guides/cli.md) | CLI-транспорт: single-shot и REPL | `examples.simple-cli` |
| [testing.md](./guides/testing.md) | App-тесты: `assembleTest`, `overrides` + прунинг, `.check()`-матрица, `vars()`, `./testing`-subpath | `examples.app-with-http` |
| [subscriptions.md](./guides/subscriptions.md) | Реестр подписок: модуль `subscriptions()`, слой `tracked`, `meta.subscription.signal`, админ-ручки, факты контрактами | `examples.app-with-http` |

## design/ — целевое состояние V1

Карта и правила папки — [design/README.md](./design/README.md). Кратко:
design-доки описывают **только целевое V1** (как будто уже реализовано),
по одному доку на подсистему; статусы реализации и порядок работ живут
в [roadmap](./decisions/roadmap.md); «почему» — в записях
[ideas.md](./decisions/ideas.md), на которые ссылается плашка каждого дока.

## decisions/

- [ideas.md](./decisions/ideas.md) — основной журнал: зафиксированные
  архитектурные решения с логикой принятия и отвергнутыми вариантами.
  Формат записи: дата, контекст, решение, открытые вопросы.
- [roadmap.md](./decisions/roadmap.md) — план доработок до целевого
  состояния: список OpenSpec changes, порядок, зависимости, статусы.
  Живой документ (статусы обновляются).
- [archlog.md](./decisions/archlog.md) — короткий лог заархивированных
  changes; там же ранние решения (endpoint-классы вместо контроллеров,
  модули как объекты).
- [deferred.md](./decisions/deferred.md) — отложенные темы: обсуждено и
  осознанно не принято/не запланировано; контекст, что уже придумано,
  триггер возврата. Для тем без своей записи в ideas.md.

## Правила ведения

1. **Папка = статус.** Никаких «наполовину актуальных» документов.
2. **`design/` — единственное место, где целевой API описан целиком.**
   Меняется решение → правится design-док по месту + добавляется запись
   в `decisions/`. «Почему» живёт в decisions, «что» — в design.
3. **В `design/` нет порядка работ и статусов реализации** — только
   целевое V1 и ссылки: на записи ideas.md (логика) и на roadmap (статус).
   Слова «v2» в целевых доках не существует: осознанно исключённое из V1 —
   в [deferred](./decisions/deferred.md) и открытых вопросах записей.
4. **`decisions/` append-only, `history/` immutable.** Устаревшую запись
   не редактируем — помечаем superseded со ссылкой на новую.
5. **Каждый design-док начинается с плашки** «Целевое состояние V1» со
   ссылками на записи журнала и roadmap.
6. **Новые дискуссии** — сразу в `history/discussions/NN-тема.md`.
   Корень репозитория для документации закрыт (кроме README).
7. **Гайды сверяются с примерами.** Каждый гайд в `guides/` начинается
   с плашки «сверено с кодом <пример> (дата)». Изменил пример — обнови
   гайд и дату.
